/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 *
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 *
 * Javier Fernández-Bravo Peñuela
 *
 * trebizond-server/server.ts
 */

import { Operation,
         Message,
         OpMessage,
         LeadershipVote,
         LeaderConfirmation,
         TrebizondResult,
         SingleReply,
         CollectiveReply,
         Init,
         Echo,
         Ready,
         AtomicBroadcastMessageLog } from '../trebizond-common/datatypes';
import { BlockChain,
         StateMachine } from '../state-machine-connector/command';
import { ServerNetworkController,
         ServerDefinition } from './networkController';
import { FailureDetector } from './failureDetector';
import { SignedObject,
         hashObject,
         decryptText,
         signObject } from '../trebizond-common/crypto';

/**
 * Base class for a Trebizond server.
 * Provides complete networking functionality, common to all nodes.
 * @param <Op> Generic type, resolved when the class is instantiated.
 * It is the type of the commands sent to the server by the client,
 * and managed by the server cluster.
 * @param <R> Generic type, resolved when the class is instantiated.
 * It is the type of the results sent back to the client by the server
 * replicas.
 */
abstract class BaseTrebizondServer<Op extends Operation, R> {

    // Server identity and cluster topology
    protected id: number;
    protected internalEndpoint: string;
    protected externalEndpoint: string;
    protected privateKey: string;
    protected nReplicas: number;
    protected networkConnection: ServerNetworkController;
    protected stateMachine: StateMachine<Op, R>;

    // block chain log
    protected log: BlockChain<Op, R>;

    protected peersTopology: Record<number, ServerDefinition>;
    protected clientKeys: Record<number, Buffer>;

    /**
     * Base constructor to be accessed by children classes,
     * since this class is abstract.
     * @param serverId Numeric identifier for this server.
     * @param peersTopology Endpoint distribution for the cluster topology.
     *          Record object containing the identifiers for the nodes
     *          in the cluster along with their numeric identifiers.
     * @param clientKeys Identifiers of the authorized clients along with their
     *          public keys.
     * @param externalEndpoint IP address and port onto which the server
     *          will attend client's requests.
     * @param serverPrivateKey Private key of this server for signing messages
     *          to be sent and decrypting messages received.
     * @param stateMachine State machine onto which the command operations
     *          will be executed. Potentially, a subclass inheriting the
     *          behavior provided by the base StateMachine class.
     */
    public constructor(serverId: number, peersTopology: Record<number, ServerDefinition>,
            clientKeys: Record<number, Buffer>, externalEndpoint: string,
            serverPrivateKey: string, stateMachine: StateMachine<Op, R>) {
        this.id = serverId;
        this.peersTopology = peersTopology;
        this.nReplicas = Object.keys(peersTopology).length;
        this.externalEndpoint = externalEndpoint;
        this.internalEndpoint = peersTopology[serverId].endpoint;
        this.privateKey = serverPrivateKey;
        this.clientKeys = clientKeys;
        this.stateMachine = stateMachine;

        this.log = new BlockChain();

        // Initialize the networking layer beneath
        this.networkConnection = new ServerNetworkController(serverId,
            peersTopology, externalEndpoint, serverPrivateKey, clientKeys,
            this.dispatchPeerMessage.bind(this),
            this.dispatchClientOpRequest.bind(this));
    }

    protected getId(): number {
        return this.id;
    }

    protected getNReplicas(): number {
        return this.nReplicas;
    }

    protected getExposedEndpoint(): string {
        return this.externalEndpoint;
    }

    protected getInternalEndpoint(): string {
        return this.internalEndpoint;
    }

    /**
     * Starts the consensus algorithm on this server
     */
    public abstract launch(): void;

    /**
     * Manages the receival of an operation request from a client
     * @param operation The command to be managed and applied to the replicated
     *                  state machine by the servers cluster
     */
    public abstract dispatchClientOpRequest(operation: SignedObject<OpMessage<Op>>): void;

    /**
     * Reply to a client upon a previously submitted operation
     * @param reply The result message to be sent back to the client
     */
    public replyClientOperation(reply: Message): void {
        this.networkConnection.replyClientOperation(reply);
    }

    /**
     * Manages a message of any type received from another server.
     * It might be a request as well as a result. Depending on its
     * type the message will be redirected to the corresponding method
     * at a more specific level.
     * @param message A message of any type received from another server in the cluster
     */
    protected abstract dispatchPeerMessage(message: SignedObject<Message>): void;

    /**
     * Sends a message of any type to another replica in the cluster.
     * @param message The message to be sent
     * @param recipientId Identifier of the request's recipient
     */
    protected sendUnicast(message: Message, recipientId: number): void {
        this.networkConnection.sendMessage(message, recipientId);
    }

    /**
     * Sends a message of any type to a subset of peer replicas in the cluster.
     * @param message The message to be sent
     * @param recipientIds Identifiers of the request's recipients
     */
    protected sendMulticast(message: Message, recipientIds: number[]): void {
        this.networkConnection.sendMulticast(message, recipientIds);
    }

    /**
     * Sends a message of any type to every peer replica in the cluster.
     * @param message The message to be sent
     */
    protected sendBroadcast(message: Message): void {
        this.networkConnection.sendBroadcast(message);
    }

    protected lowerBoundThreshold(n: number = this.nReplicas): number {
        return Math.ceil((n - 1) / 3);
    }

    protected upperBoundThreshold(n: number = this.nReplicas): number {
        return Math.ceil((2 * n + 1) / 3);
    }
}

/**
 * Complete implementation of a Trebizond server.
 * In addition of the functionality provided by its parent class, it also
 * implements the atomic broadcast and successive leader rotation algorithms.
 */
class TrebizondServer<Op extends Operation, R extends object> extends BaseTrebizondServer<Op, R> {

    private currentLeaderId = 0;
    private currentStage = 0;
    private votesRegistry: Record<number, Record<number, SignedObject<LeadershipVote>>> = {};

    private clientLastOp: Record<number, TrebizondResult<R>> = {};

    private messagesLog: Record<string, AtomicBroadcastMessageLog<Op, R>> = {};

    /**
     * @inheritDoc
     */
    constructor(serverId: number, peersTopology: Record<number, ServerDefinition>,
            clientKeys: Record<number, Buffer>, externalEndpoint: string,
            serverPrivateKey: string, stateMachine: StateMachine<Op, R>) {
        super(serverId, peersTopology, clientKeys, externalEndpoint,
            serverPrivateKey, stateMachine);
        this.currentLeaderId = Object.keys(peersTopology).map(Number).sort()[0];

        // Initialize a failure detector, passing the newly created network controller,
        // so that it will be binded as a message interceptor
        const peerKeys = Object.fromEntries(Object.entries(this.peersTopology).map(
            ([id, peer]) => [id, peer.publicKey]));
        new FailureDetector<Op>(serverId, peerKeys,
            this.networkConnection, stateMachine.getMessageValidator());
    }

    public launch(): void {
        this.resetTimeout(this.LEADER_TIMEOUT * 2);
    }

    /**
     * @inheritDoc
     */
    protected dispatchPeerMessage(message: SignedObject<Message>): void {
        switch (message.value.type) {
            case 'LeaderConfirmation':
                this.receiveLeaderConfirmation(message.value as LeaderConfirmation);
                break;
            case 'LeadershipVote':
                this.receiveLeadershipVote(message as SignedObject<LeadershipVote>);
                break;
            case 'Init':
                this.receiveInitMessage(message.value as Init<Op>);
                break;
            case 'Echo':
                this.receiveEchoMessage(message.value as Echo<Op>);
                break;
            case 'Ready':
                this.receiveReadyMessage(message.value as Ready<Op>);
                break;
            case 'SingleReply':
                this.receiveSingleReply(message.value as SingleReply<R>);
                break;
        }
    }

    /**
     * @inheritDoc
     */
    public dispatchClientOpRequest(operation: SignedObject<OpMessage<Op>>): void {
        const op = operation.value.operation;

        // Operation request received goes right through validations, handle it.
        // Otherwise, discard and ignore it.
        if (this.stateMachine.getMessageValidator()
                .semanticValidation(op.operation)) {

            // If operation request identifier matches that of the last operation
            // accepted for the same client, return the result stored beforehand
            const lastOp = this.clientLastOp[operation.value.from];
            if (lastOp && lastOp.opUuid === op.uuid) {
                this.replyClientOperation({
                    type: 'SingleReply',
                    result: signObject(lastOp, this.privateKey),
                    from: this.id
                } as SingleReply<R>);
            } else {

                // In case of receiving a new readonly operation, execute it
                // and return its result immediately
                if (this.stateMachine.isReadOperation(op.operation)) {
                    this.stateMachine.executeOperation(op.operation).then((result: R) => {
                        this.replyClientOperation({
                            type: 'SingleReply',
                            result: signObject({
                                result: result,
                                opUuid: op.uuid
                            } as TrebizondResult<R>,
                                this.privateKey),
                            from: this.id
                        } as SingleReply<R>);
                    });
                } else {

                    // New write operation client request received
                    const opInit: Init<Op> = {
                        type: 'Init',
                        currentStatus: hashObject(this.log),
                        operation: operation,
                        from: this.id
                    };
                    this.sendBroadcast(opInit);
                    this.receiveInitMessage(opInit);
                }
            }
        }
    }

    private readonly LEADER_TIMEOUT: number = 5000;

    private resetTimeout(timeout = this.LEADER_TIMEOUT) {
        setTimeout(this.leaderTimeout.bind(this), timeout);
    }

    /**
     * This node votes for the replica it thinks to be the prospective
     * next leader, based on the stage number.
     */
    protected leaderTimeout() {
        const nextLeader = ++this.currentStage % this.nReplicas;
        const leaderVote: LeadershipVote = {
            vote: nextLeader,
            epoque: this.currentStage,
            type: 'LeadershipVote',
            from: this.id
        };
        this.sendUnicast(leaderVote, nextLeader);

        this.resetTimeout();
    }

    /**
     * Leader confirmation received
     * @param leadership Leader confirmation for a stage
     */
    private receiveLeaderConfirmation(leadership: LeaderConfirmation) {

        // Verify votes authenticity
        if (leadership.leader.vote === leadership.from
                && leadership.leader.epoque >= this.currentStage
                && Object.keys(leadership.votes).length >= this.upperBoundThreshold()) {
            const vote: LeadershipVote = {
                type: 'LeadershipVote',
                vote: leadership.leader.vote,
                epoque: leadership.leader.epoque,
                from: leadership.from
            };
            let nVotes = 0;
            Object.entries(leadership.votes).forEach(([k, v]) => {
                const key = Number(k);
                vote.from = key;
                const voteHash = hashObject(leadership.leader);
                const sourceKey = this.peersTopology[key].publicKey;
                if (sourceKey && decryptText(v, sourceKey.toString('utf8')) === voteHash) {
                    nVotes++;
                }
            });

            /**
             * Valid leadership confirmation for a stage equal or higher than
             * the current one. Current leader and stage identifiers are updated.
             * Otherwise, the leadership confirmation message is discarded.
             */
            if (nVotes === Object.keys(leadership.votes).length) {
                this.currentLeaderId = leadership.leader.vote;
                this.currentStage = leadership.leader.epoque;
            }
        }
    }

    /**
     * Leadership vote received
     * @param signedVote Leadership vote for a node and a stage
     */
    private receiveLeadershipVote(signedVote: SignedObject<LeadershipVote>) {

        /**
         *  Verify whether leadership vote is valid, being destinated
         * to this replica for a stage equal or higher than the
         * current one. Otherwise, the leadership vote message is discarded.
         */
        const vote = signedVote.value;
        if (vote.vote === this.id
                && vote.epoque >= this.currentStage
                && !(vote.epoque in this.votesRegistry
                    && vote.from in this.votesRegistry[vote.epoque])) {
            if (!(vote.epoque in this.votesRegistry)) {
                this.votesRegistry[vote.epoque] = {};
            }
            this.votesRegistry[vote.epoque][vote.from] = signedVote;

            /**
             * If the number of votes needed for this replica to proclame itself the leader
             * for a stage equal or higher than the current one has been reached. The current
             * leader and stage identifers are updated and the votes gathered are sent as an
             * evidence to the other replicas.
             */
            if (Object.keys(this.votesRegistry[vote.epoque]).length >= this.upperBoundThreshold()) {
                const votes: Record<number, Uint8Array> = {};
                Object.entries(this.votesRegistry[vote.epoque]).forEach(([key, value]) => {
                    votes[Number(key)] = value.signature;
                });
                /*this.votesRegistry.get(vote.epoque).forEach((value, key) => {
                    votes.set(key, value.signature);
                });*/
                const leadershipConfirmation: LeaderConfirmation = {
                    type: 'LeaderConfirmation',
                    leader: {
                        type: 'LeadershipVote',
                        vote: vote.vote,
                        epoque: vote.epoque,
                        from: this.id
                    },
                    votes: votes,
                    from: this.id
                };
                this.sendBroadcast(leadershipConfirmation);
            }
        }
    }

    /**
     * Init message received
     * @param initMsg Init message received from another replica as a part
     *                  of the three-staged atomic broadcast algorithm
     */
    private receiveInitMessage(initMsg: Init<Op>) {
        const opId = initMsg.operation.value.operation.uuid;

        /**
         * Store this message in case no previous Init message existed
         * for the same operation and replica
         */
        if (opId in this.messagesLog) {
            const init = this.messagesLog[opId].init;
            if (!(initMsg.from in init)) {
                init[initMsg.from] = initMsg;
            }
        } else {
            this.messagesLog[opId] = {
                init: { [initMsg.from]: initMsg },
                echo:  {},
                ready: {},
                accepted: [],
                replies:  {}
            };
        }

        this.checkOperationAtomicBroadcastPhase1(opId);
    }

    /**
     * Echo message received
     * @param echoMsg Echo message received from another replica as a part
     *                  of the three-staged atomic broadcast algorithm
     */
    private receiveEchoMessage(echoMsg: Echo<Op>) {
        const opId = echoMsg.operation.value.operation.uuid;

        /**
         * Store this message in case no previous Echo message existed
         * for the same operation and replica
         */
        if (opId in this.messagesLog) {
            const echo = this.messagesLog[opId].echo;
            if (!(echoMsg.from in echo)) {
                echo[echoMsg.from] = echoMsg;
            }
        } else {
            this.messagesLog[opId] = {
                init: {},
                echo: { [echoMsg.from]: echoMsg },
                ready: {},
                accepted: [],
                replies: {}
            };
        }

        this.checkOperationAtomicBroadcastPhase1(opId);
        this.checkOperationAtomicBroadcastPhase2(opId);
    }

    /**
     * Ready message received
     * @param readyMsg Ready message received from another replica as a part
     *                  of the three-staged atomic broadcast algorithm
     */
    private receiveReadyMessage(readyMsg: Ready<Op>) {
        const opId = readyMsg.operation.value.operation.uuid;

        /**
         * Store this message in case no previous Ready message existed
         * for the same operation and replica
         */
        if (opId in this.messagesLog) {
            const ready = this.messagesLog[opId].ready;
            if (!(readyMsg.from in ready)) {
                ready[readyMsg.from] = readyMsg;
            }
        } else {
            this.messagesLog[opId] = {
                init: {},
                echo: {},
                ready: { [readyMsg.from]: readyMsg },
                accepted: [],
                replies: {}
            };
        }

        this.checkOperationAtomicBroadcast(opId);
    }

    /**
     * Check whether atomic broadcast's conditions are met for all three stages
     * for an operation.
     * @param opId Tentative operation identifier
     */
    private checkOperationAtomicBroadcast(opId: string): void {
        this.checkOperationAtomicBroadcastPhase1(opId);
        this.checkOperationAtomicBroadcastPhase2(opId);
        this.checkOperationAtomicBroadcastPhase3(opId);
    }

    /**
     * Check whether atomic broadcast's first stage conditions are met for an operation.
     * In such a case, send (broadcast) Echo messages to all replicas.
     * @param opId Tentative operation identifier
     */
    private checkOperationAtomicBroadcastPhase1(opId: string): boolean {
        const messagesLogOpId = this.messagesLog[opId];
        if (messagesLogOpId
                && !(this.id in messagesLogOpId.echo)
                && (Object.keys(messagesLogOpId.init).length >= 1
                    || Object.keys(messagesLogOpId.echo).length >= (this.nReplicas + this.lowerBoundThreshold()) / 2
                    || Object.keys(messagesLogOpId.ready).length !== this.lowerBoundThreshold() + 1)) {
            const op = this.getOperationFromLog(opId);
            if (op) {
                const newEchoMsg: Echo<Op> = {
                    type: 'Echo',
                    currentStatus: hashObject(this.log),
                    operation: op,
                    from: this.id
                };
                this.sendBroadcast(newEchoMsg);
                this.receiveEchoMessage(newEchoMsg);
                return true;
            }
        }
        return false;
    }

    /**
     * Check whether atomic broadcast's second stage conditions are met for an operation.
     * In such a case, send (broadcast) Ready messages to all replicas.
     * @param opId Tentative operation identifier
     */
    private checkOperationAtomicBroadcastPhase2(opId: string): boolean {
        const messagesLogOpId = this.messagesLog[opId];
        if (messagesLogOpId
                && !(this.id in messagesLogOpId.ready)
                && (Object.keys(messagesLogOpId.echo).length >= (this.nReplicas + this.lowerBoundThreshold()) / 2
                    || Object.keys(messagesLogOpId.ready).length >= this.lowerBoundThreshold() + 1)) {
            const op = this.getOperationFromLog(opId);
            if (op) {
                const newReadyMsg: Ready<Op> = {
                    type: 'Ready',
                    currentStatus: hashObject(this.log),
                    operation: op,
                    from: this.id
                };
                this.sendBroadcast(newReadyMsg);
                this.receiveReadyMessage(newReadyMsg);
                return true;
            }
        }
        return false;
    }

    /**
     * Check whether atomic broadcast's third stage conditions are met for an operation.
     * In such a case, that operation can be accepted.
     * @param opId Tentative operation identifier
     */
    private checkOperationAtomicBroadcastPhase3(opId: string): boolean {
        const messagesLogOpId = this.messagesLog[opId];
        if (messagesLogOpId
                && messagesLogOpId.accepted.indexOf(opId) < 0
                && Object.keys(messagesLogOpId.ready).length >= 2 * this.lowerBoundThreshold() + 1) {
            const op = this.getOperationFromLog(opId);

            /*
            * Depending on whether this operation's request was unicasted or broadcasted,
            * the reply is sent back to the current leader or to the original requester client.
            */
            if (op) {
                const recipient = op.value.operation.broadcast ? op.value.from : this.currentLeaderId;
                this.messagesLog[opId].accepted.push(opId);
                this.stateMachine.executeOperation(op.value.operation.operation).then((result: R) => {
                    const trebizondResult: TrebizondResult<R> = {
                        result,
                        opUuid: op.value.operation.uuid
                    };
                    this.clientLastOp[op.value.from] = trebizondResult;
                    this.log.appendNextBlock(op.value.operation.operation, result, this.privateKey);
                    this.sendUnicast({
                                type: 'SingleReply',
                                result: signObject(trebizondResult,
                                        this.privateKey) as SignedObject<TrebizondResult<R>>,
                                from: this.id
                            } as SingleReply<R>,
                            recipient);
                    return true;
                });
            }
        }
        return false;
    }

    /**
     * Received single reply message from another replica
     * @param singleReplyMsg Single reply message received from another replica
     */
    private receiveSingleReply(singleReplyMsg: SingleReply<R>): void {
        let opLog: AtomicBroadcastMessageLog<Op, R>;
        const opId = singleReplyMsg.result.value.opUuid;
        if (opId in this.messagesLog) {
            opLog = this.messagesLog[opId];
        } else {
            opLog = {
                init: {},
                echo: {},
                ready: {},
                accepted: [],
                replies: {}
            };
            this.messagesLog[opId] = opLog;
        }

        // Store signed single reply message just received
        if (!this.instanceofCollectiveReply(opLog.replies)) {
            opLog.replies[singleReplyMsg.from] = singleReplyMsg;

            /*
             * Check whether enough matching replies for an already accepted operation
             * have been gathered, and proceed subsequently.
             */
            this.checkSingleRepliesForCollectiveReply(opId);
        }
    }

    /**
     * Check whether enough matching single replies for an already accepted operation
     * have been gathered. In such a case, compose a collective reply, store it as the
     * final result for that operation, and send it back to the client.
     * @param opId Tentative operation identifier
     */
    private checkSingleRepliesForCollectiveReply(opId: string): boolean {
        const messagesLogOpId = this.messagesLog[opId];
        if (messagesLogOpId
                && !this.instanceofCollectiveReply(messagesLogOpId.replies)) {
            const singleReplies = this.messagesLog[opId].replies as Record<number, SingleReply<R>>;
            const threshold = this.upperBoundThreshold();

            if (Object.keys(singleReplies).length >= threshold
                    && this.enoughMatchingReplies(singleReplies, threshold)) {
                const collectiveReply = this.composeCollectiveReply(opId, singleReplies);
                messagesLogOpId.replies = collectiveReply;
                this.replyClientOperation(collectiveReply);
                return true;
            }
        }
        return false;
    }

    private getOperationFromLog(opId: string): SignedObject<OpMessage<Op>> {
        let op: SignedObject<OpMessage<Op>>;
        const messagesLogOpId = this.messagesLog[opId];
        if (Object.keys(messagesLogOpId.init).length) {
            op = Object.values(messagesLogOpId.init)[0].operation;
        } else {
            if (Object.keys(messagesLogOpId.echo).length) {
                op = Object.values(messagesLogOpId.echo)[0].operation;
            } else {
                op = Object.keys(messagesLogOpId.ready).length ?
                    Object.values(messagesLogOpId.ready)[0].operation : null;
            }
        }
        return op;
    }

    private enoughMatchingReplies(singleReplies: Record<number, SingleReply<R>>,
            threshold: number): R {
        const winner = this.winnerResult(singleReplies);
        return winner !== null && winner[1] >= threshold ? winner[0] : null;
    }

    private winnerResult(singleReplies: Record<number, SingleReply<R>>): [R, number] {
        let result: R;
        let max = 0;

        const auxReplies: Record<string, [number, R]> = {};
        for (const r of Object.values(singleReplies)) {
            const hash = hashObject(r.result.value.result);
            if (hash in auxReplies) {
                const replyCount = auxReplies[hash];
                auxReplies[hash] = [replyCount[0] + 1, replyCount[1]];
            } else {
                auxReplies[hash] = [1, r.result.value.result];
            }
        }

        for (const r of Object.values(auxReplies)) {
            if (r[0] > max) {
                result = r[1];
                max = r[0];
            }
        }

        return result !== null ? [result, max] : null;
    }

    private composeCollectiveReply(opId: string, singleReplies: Record<number, SingleReply<R>>):
            CollectiveReply<R> {
        const result = this.winnerResult(singleReplies);
        const resultHash = hashObject(result[0]);

        const resultAcknowledgments: Record<number, Uint8Array> = {};
        for (const r of Object.keys(singleReplies)) {
            const replica = Number(r);
            const reply = singleReplies[replica];
            if (hashObject(reply.result.value.result) === resultHash) {
                resultAcknowledgments[replica] = reply.result.signature;
            }
        }

        return {
            type: 'CollectiveReply',
            result: {
                result: result[0],
                opUuid: opId
            } as TrebizondResult<R>,
            resultAcknowledgments: resultAcknowledgments,
            from: this.id
        } as CollectiveReply<R>;
    }

    instanceofCollectiveReply(obj: object): obj is CollectiveReply<R> {
        return !!Object.getOwnPropertyDescriptor(obj, 'type')
            && (obj as CollectiveReply<R>).type === 'CollectiveReply';
    }
}

/**
 * Extends the functionality provided by the Trebizond complete server,
 * enabling its manipulation for the sake of testing and debugging.
 */
class OperableTrebizondServer<Op extends Operation, R extends object> extends TrebizondServer<Op, R> {

    stopped = false;

    constructor(serverId: number, peersTopology: Record<number, ServerDefinition>,
            clientKeys: Record<number, Buffer>, externalEndpoint: string,
            serverPrivateKey: string, stateMachine: StateMachine<Op, R>) {
        super(serverId, peersTopology, clientKeys, externalEndpoint,
            serverPrivateKey, stateMachine);
    }

    // TODO AUGMENT STOP FUNCTIONALITY
}

export { TrebizondServer, OperableTrebizondServer,
    ServerDefinition as PeerDefinition };
