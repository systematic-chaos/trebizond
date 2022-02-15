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
import { every,
         uuidv4 } from '../trebizond-common/util';
import { Message,
         LeaderRedirection,
         CollectiveReply,
         SingleReply,
         Operation,
         Result,
         TrebizondOperation,
         TrebizondResult } from '../trebizond-common/datatypes';
import * as zeromq from 'zeromq';

export class TrebizondClient<Op extends Operation, R extends Result> {

    private clientId: number;
    private privateKey: string;

    // server id, [server endpoint, server public key]
    private serversTopology: Map<number, [string, string]>;

    private cipher: Cipher;

    private requestSockets: Map<number, zeromq.Socket>;

    private nReplicas: number;
    private pendingOperations: Array<[TrebizondOperation<Op>, QPromise<R>]> = [];
    private currentOperation: [TrebizondOperation<Op>, QPromise<R>] | null = null;
    private currentLeaderId: number;
    private unicastAttempts: number = 0;
    private currentReplies: Map<number, R> = new Map<number, R>();
    private lastOperationResult: R | null = null;
    private timerExpired: boolean = false;

    protected static readonly TRANSPORT_PROTOCOL: string = 'tcp';
    protected static readonly PROTOCOL_PREFIX: string = TrebizondClient.TRANSPORT_PROTOCOL + '://';

    constructor(client: [number, string],
            serversTopology: Map<number, [string, string]>) {
        this.clientId = client[0];
        this.privateKey = client[1];
        this.serversTopology = serversTopology;

        this.cipher = new Cipher(this.privateKey);
        this.requestSockets = new Map<number, zeromq.Socket>();
        this.connectToServers(serversTopology, this.requestSockets);

        this.nReplicas = this.requestSockets.size;
        this.currentLeaderId = this.randomizeCurrentLeader();
    }

    private connectToServers(serverTopology: Map<number, [string, any]>,
            requestSockets: Map<number, zeromq.Socket>): number {
        serverTopology.forEach((value: [string, any], serverId: number) => {
            if (!value[0].startsWith(TrebizondClient.PROTOCOL_PREFIX)) {
                let serverEndpoint = TrebizondClient.PROTOCOL_PREFIX + value[0];
                serverTopology.set(serverId, [serverEndpoint, value[1]]);
                let serverSocket = zeromq.createSocket('req');
                try {
                    serverSocket.connect(serverEndpoint);
                    console.log('Connected to cluster endpoint ' + serverId +
                        ' (' + serverEndpoint + ')');
                    
                    serverSocket.on('message', (msg: any) => {
                        this.dispatchServerMessage(JSON.parse(msg), serverId);
                    });
                    requestSockets.set(serverId, serverSocket);
                } catch(ex) {
                    console.error('Failed to connect to cluster endpoint ' +
                        serverId + ' (' + serverEndpoint + ')');
                }
            }
        });
        return requestSockets.size;
    }

    public sendCommand(command: Op): Promise<R> {
        var operation = this.generateOperationFromCommand(command);
        var p = new QPromise<R>();
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
            this.currentOperation = this.pendingOperations.shift()!;
            this.unicastAttempts = 0;
            this.lastOperationResult = null;
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
        if (leadRedir.from == this.currentLeaderId
            && leadRedir.leader == this.currentLeaderId
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
        if (leadRedir.from == this.currentLeaderId
            && leadRedir.leader != this.currentLeaderId) {
                this.currentLeaderId = leadRedir.leader;
                /*this.unicastAttempts++;*/
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
            var mainResult: TrebizondResult<R> = reply.result;
            var mainResultHash = hashObject(mainResult);
            if (reply.resultAcknowledgments.size >= (2 * this.nReplicas + 1) / 3
                    && every(Array.from(reply.resultAcknowledgments),
                            this.matchesResultDigest.bind(this), mainResultHash)) {
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
                && this.currentOperation[0].uuid == reply.result.value.opUuid
                && !this.currentReplies.has(reply.from)) {
            this.currentReplies.set(reply.from, reply.result.value.result);

            /**
             * Set minimum votes a result must gather in order to reach consensus,
             * depending on its nature as a read-only or a write-implying operation
             */
            var consensusThreshold = this.currentOperation[0].operation.isReadOperation() ?
                    this.readOpConsensusThreshold()
                    : this.writeOpConsensusThreshold();
            var consensusResult = this.enoughMatchingReplies(consensusThreshold);

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
                this.currentReplies.clear();
                this.unicastAttempts = -1;
                this.resetTimer(this.currentOperation[0]);
                this.broadcastOperationRequest(this.currentOperation[0]);
            }
        }
    }

    private matchesResultDigest(acknowledgment: [number, Uint8Array], mainHash?: string): boolean {
        var source: number = acknowledgment[0];
        var source: number = acknowledgment[0];
        return this.serversTopology.has(source)
                && mainHash === decryptText(acknowledgment[1], this.serversTopology.get(source)![1]);
    }
    
    private unicastOperationRequest(operation: TrebizondOperation<Op>): void {
        var currentServerEndpoint: String = this.serversTopology.get(this.currentLeaderId)![0];
        console.log('Sending operation to ' + this.currentLeaderId +
        '(' + currentServerEndpoint + ')');
        console.log(JSON.stringify(operation.operation));
        var marshalledSignedOp = JSON.stringify(this.cipher.signObject(operation));
        this.requestSockets.get(this.currentLeaderId)!.send(marshalledSignedOp);
    }
    
    private broadcastOperationRequest(operation: TrebizondOperation<Op>): void {
        operation.broadcast = true;
        console.log('Broadcasting operation to all replicas');
        console.log(JSON.stringify(operation.operation));
        var marshalledSignedOp = JSON.stringify(this.cipher.signObject(operation));
        for (let socket of this.requestSockets.values()) {
            socket.send(marshalledSignedOp);
        }
    }

    /**
     * Resolve the promise related to the current operation.
     * @param result The value obtained by the current operation's execution,
     * to be provided as the value bound to the promise's resolution
     */
    private resolveCurrentOperation(result: R): void {
        var promise = this.currentOperation![1];
        this.currentOperation = null;
        this.currentReplies.clear();
        this.lastOperationResult = result;
        promise.resolve(result);
    }

    private enoughMatchingReplies(threshold: number): R | null {
        var winner = this.winnerResult();
        return winner !== null && winner[1] >= threshold ? winner[0] : null;
    }

    private canReachConsensus(threshold: number): boolean {
        var potentialConsensus: boolean = true;
        if (this.currentReplies.size > 0
                && this.enoughMatchingReplies(threshold) == null) {
            var winner = this.winnerResult()!;
            potentialConsensus =
                threshold - winner[1] <= this.nReplicas - this.currentReplies.size;
        }
        return potentialConsensus;
    }

    private winnerResult(): [R, number] | null {
        var result: R | null = null;
        var max = 0;
        
        var replies = new Map<string, [number, R]>();
        for (let r of this.currentReplies.values()) {
            let hash = hashObject(r);
            if (replies.has(hash)) {
                let replyCount = replies.get(hash)!;
                replies.set(hash, [replyCount[0] + 1, replyCount[1]]);
            } else {
                replies.set(hash, [1, r]);
            }
        }

        for (let r of replies.values()) {
            if (r[0] > max) {
                result = r[1];
                max = r[0];
            }
        }

        return result !== null ? [result, max] : null;
    }
    
    private dispatchServerMessage(signedMsg: SignedObject<Message>, from: number) {
        var sourceKey = this.serversTopology.get(from)![1];
        if (from == signedMsg.value.from
                && checkObjectSignature(signedMsg, sourceKey)) {
            var msg = signedMsg.value;
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
