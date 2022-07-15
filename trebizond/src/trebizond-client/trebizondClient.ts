/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 *
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 *
 * Javier Fernández-Bravo Peñuela
 *
 * trebizond-client/trebizondClient.ts
 */

import { Cipher,
         SignedObject,
         checkObjectSignature,
         decryptText,
         hashObject } from '../trebizond-common/crypto';
import { Deferred as QPromise } from '../trebizond-common/deferred';
import { uuidv4 } from '../trebizond-common/util';
import { Message,
         LeaderRedirection,
         CollectiveReply,
         SingleReply,
         Operation,
         TrebizondOperation } from '../trebizond-common/datatypes';
import * as zeromq from 'zeromq';

export class TrebizondClient<Op extends Operation, R extends object> {

    private clientId: number;
    private privateKey: string;

    // server id, [server endpoint, server public key]
    private serversTopology: Record<number, [string, Buffer]>;

    private cipher: Cipher;

    private requestSockets: Record<number, zeromq.Socket>;

    private nReplicas: number;
    private pendingOperations: Array<[TrebizondOperation<Op>, QPromise<R>]> = [];
    private currentOperation: [TrebizondOperation<Op>, QPromise<R>] | null = null;
    private currentLeaderId: number;
    private unicastAttempts = 0;
    private currentReplies: Record<number, R> = {};
    private timerExpired = false;

    protected static readonly TRANSPORT_PROTOCOL: string = 'tcp';
    protected static readonly PROTOCOL_PREFIX: string = TrebizondClient.TRANSPORT_PROTOCOL + '://';

    constructor(client: [number, string],
            serversTopology: Record<number, [string, Buffer]>) {
        this.clientId = client[0];
        this.privateKey = client[1];
        this.serversTopology = serversTopology;

        this.cipher = new Cipher(this.privateKey);
        this.requestSockets = {};
        this.connectToServers(serversTopology, this.requestSockets);

        this.nReplicas = Object.keys(this.requestSockets).length;
        this.currentLeaderId = this.randomizeCurrentLeader();
    }

    private connectToServers(serverTopology: Record<number, [string, Buffer]>,
            requestSockets: Record<number, zeromq.Socket>): number {
        Object.entries(serverTopology).forEach(([sId, value]) => {
            if (!value[0].startsWith(TrebizondClient.PROTOCOL_PREFIX)) {
                const serverId = Number(sId);
                const serverEndpoint = TrebizondClient.PROTOCOL_PREFIX + value[0];
                serverTopology[serverId] = [serverEndpoint, value[1]];
                const serverSocket = zeromq.createSocket('req');
                try {
                    serverSocket.connect(serverEndpoint);
                    console.log('Connected to cluster endpoint ' + serverId +
                        ' (' + serverEndpoint + ')');

                    serverSocket.on('message', msg => {
                        this.dispatchServerMessage(JSON.parse(msg), serverId);
                    });
                    requestSockets[serverId] = serverSocket;
                } catch(ex) {
                    console.error('Failed to connect to cluster endpoint ' +
                        serverId + ' (' + serverEndpoint + ')');
                }
            }
        });
        return Object.keys(requestSockets).length;
    }

    public sendCommand(command: Op): Promise<R> {
        const operation = this.generateOperationFromCommand(command);
        const p = new QPromise<R>();
        this.pendingOperations.push([operation, p]);

        if (this.currentOperation === null) {
            this.processNextOperation();
        }

        return p.promise;
    }

    private generateOperationFromCommand(command: Op): TrebizondOperation<Op> {
        return {
            operation: command,
            uuid: uuidv4(),
            timestamp: new Date(),
            broadcast: false
        };
    }

    private processNextOperation(): void {
        if (this.currentOperation === null && this.pendingOperations.length > 0) {
            // First delivery attempt for the new current operation
            this.currentOperation = this.pendingOperations.shift();
            this.unicastAttempts = 0;
            this.timerExpired = false;

            this.resetTimer(this.currentOperation[0]);
            this.unicastOperationRequest(this.currentOperation[0]);
            this.unicastAttempts++;
        }
    }

    private processLeaderRedirection(leadRedir: LeaderRedirection) {

        /**
         * During an operation's processing, the node suppossed to be the leader
         * proclaims itself as the leader. This misleading behavior is potentially
         * bizantine. As a consequence, the current leader identifier is randomly
         * assigned and the current operation is broadcasted to all replicas.
         */
        if (leadRedir.from === this.currentLeaderId
            && leadRedir.leader === this.currentLeaderId
            && this.unicastAttempts >= 0
            && this.currentOperation !== null) {
                this.unicastAttempts = -1;
                this.randomizeCurrentLeader();
                this.broadcastOperationRequest(this.currentOperation[0]);
        }

        /**
         * The node suppossed to be the leader redirects to another node.
         * The current leader identifier is reassigned to the node indicated
         * by the (now) former leader.
         */
        if (leadRedir.from === this.currentLeaderId
                && leadRedir.leader !== this.currentLeaderId) {
            this.currentLeaderId = leadRedir.leader;
            //this.unicastAttempts++;
        }
    }

    private processCollectiveReply(reply: CollectiveReply<R>) {
        /**
         * In case the reply received is related to the current operation,
         * it aggregates an amount enough of result acknowledgments, and
         * all of them are properly signed and they match the primary result
         * hash value (all these conditions being simultaneously fulfilled),
         * the result output is enabled.
         */
        if (this.currentOperation !== null
                && this.currentOperation[0].uuid === reply.result.opUuid) {
            this.currentLeaderId = reply.from;
            const mainResult = reply.result;
            const mainResultHash = hashObject(mainResult);
            if (Object.keys(reply.resultAcknowledgments).length >= (2 * this.nReplicas + 1) / 3
                    && Object.entries(reply.resultAcknowledgments).every(
                        resultAck => this.matchesResultDigest(resultAck, mainResultHash))) {
                this.resolveCurrentOperation(mainResult.result);
            }
        }
    }

    private processSingleReply(reply: SingleReply<R>) {
        /**
         * The single reply's identifier matches that of the current operation
         * and no previous reply has been received for that operation.
         * The result wrapped by the reply message is stored.
         */
        if (this.currentOperation !== null
                && this.currentOperation[0].uuid === reply.result.value.opUuid
                && !(reply.from in this.currentReplies)) {
            this.currentReplies[reply.from] = reply.result.value.result;

            /**
             * Set minimum votes a result must gather in order to reach consensus,
             * depending on its nature as a read-only or a write-implying operation
             */
            const consensusThreshold = this.currentOperation[0].operation.isReadOperation() ?
                    this.readOpConsensusThreshold()
                    : this.writeOpConsensusThreshold();
            const consensusResult = this.enoughMatchingReplies(consensusThreshold);

            /**
             * There exist a number of similar single replies to state that
             * consensus on some operation result has been reached.
             * This enables resolving asynchronous output for such a result.
             */
            if (consensusResult !== null) {
                this.resolveCurrentOperation(consensusResult);
            }

            /**
             * Current distribution of single replies disables to reach consensus
             * on a same result. All replies received are discarded and the current
             * operation is (maybe, once again) broadcasted.
             */
            else if (!this.canReachConsensus(consensusThreshold)) {
                this.currentReplies = {};
                this.unicastAttempts = -1;
                this.resetTimer(this.currentOperation[0]);
                this.broadcastOperationRequest(this.currentOperation[0]);
            }
        }
    }

    private matchesResultDigest(acknowledgment: [string, Uint8Array], mainHash?: string): boolean {
        const source = Number(acknowledgment[0]);
        return source in this.serversTopology
            && mainHash === decryptText(acknowledgment[1],
                this.serversTopology[source][1].toString('utf8'));
    }

    private unicastOperationRequest(operation: TrebizondOperation<Op>): void {
        const currentServerEndpoint = this.serversTopology[this.currentLeaderId][0];
        console.log('Sending operation to ' + this.currentLeaderId +
        '(' + currentServerEndpoint + ')');
        console.log(JSON.stringify(operation.operation));
        const marshalledSignedOp = JSON.stringify(this.cipher.signObject(operation));
        this.requestSockets[this.currentLeaderId].send(marshalledSignedOp);
    }

    private broadcastOperationRequest(operation: TrebizondOperation<Op>): void {
        operation.broadcast = true;
        console.log('Broadcasting operation to all replicas');
        console.log(JSON.stringify(operation.operation));
        const marshalledSignedOp = JSON.stringify(this.cipher.signObject(operation));
        Object.values(this.requestSockets).forEach(socket => {
            socket.send(marshalledSignedOp);
        });
    }

    /**
     * Resolve the promise related to the current operation.
     * @param result The value obtained by the current operation's execution,
     * to be provided as the value bound to the promise's resolution
     */
    private resolveCurrentOperation(result: R): void {
        this.currentOperation = null;
        this.currentReplies = {};
        this.currentOperation[1].resolve(result);
    }

    private enoughMatchingReplies(threshold: number): R | null {
        const winner = this.winnerResult();
        return winner !== null && winner[1] >= threshold ? winner[0] : null;
    }

    private canReachConsensus(threshold: number): boolean {
        let potentialConsensus = true;
        const numReplies = Object.keys(this.currentReplies).length;
        if (numReplies > 0 && !this.enoughMatchingReplies(threshold)) {
            const winner = this.winnerResult();
            potentialConsensus = winner[1] <= this.nReplicas - numReplies;
        }
        return potentialConsensus;
    }

    private winnerResult(): [R, number] | null {
        let result: R = null;
        let max = 0;

        const replies: Record<string, [number, R]> = {};
        for (const r of Object.values(this.currentReplies)) {
            const hash = hashObject(r);
            if (hash in replies) {
                const replyCount = replies[hash];
                replies[hash] = [replyCount[0] + 1, replyCount[1]];
            } else {
                replies[hash] = [1, r];
            }
        }

        for (const r of Object.values(replies)) {
            if (r[0] > max) {
                result = r[1];
                max = r[0];
            }
        }

        return result !== null ? [result, max] : null;
    }

    private dispatchServerMessage(signedMsg: SignedObject<Message>, from: number) {
        const sourceKey = this.serversTopology[from][1];
        if (from === signedMsg.value.from
                && checkObjectSignature(signedMsg, sourceKey)) {
            const msg = signedMsg.value;
            switch (msg.type) {
                case 'LeaderRedirection':
                    this.processLeaderRedirection(msg as LeaderRedirection);
                    break;
                case 'SingleReply':
                    this.processSingleReply(msg as SingleReply<R>);
                    break;
                case 'CollectiveReply':
                    this.processCollectiveReply(msg as CollectiveReply<R>);
                    break;
            }
        }
    }

    private resetTimer(timedOperation: TrebizondOperation<Op>): void {
        setTimeout(() => {
            this.timerExpired = true;
            this.timerExpiration(timedOperation);
        });
    }

    private timerExpiration(operation: TrebizondOperation<Op>): void {
        /**
         * While waiting for a result reply for an operation request, a timeout
         * related to that operation (the current one) arises. The operation request
         * is broadcasted and the timer is reset.
         */
        if (this.currentOperation !== null
                && this.currentOperation[0].uuid === operation.uuid
                && this.currentOperation[1].isPending()
                && this.timerExpired/* && this.unicastAttempts > 0*/) {
            this.unicastAttempts = -1;
            this.randomizeCurrentLeader();
            this.broadcastOperationRequest(this.currentOperation[0]);
            this.resetTimer(operation);
        }
        /**
         * Despite the conditions regarding the timer having expired either matching
         * the previous condition or this being related to a previous operation,
         * the timer expiration flag is deactivated back.
         */
        this.timerExpired = false;
    }

    private randomizeCurrentLeader(nReplicas?: number): number {
        return this.currentLeaderId =
            Math.floor(Math.random() * (nReplicas ? nReplicas : this.nReplicas));
    }

    private writeOpConsensusThreshold(n: number = this.nReplicas): number {
        return Math.ceil((2 * n + 1) / 3);
    }

    private readOpConsensusThreshold(n: number = this.nReplicas): number {
        return Math.ceil((n - 1) / 2);
    }
}
