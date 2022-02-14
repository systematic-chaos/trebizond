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
         Result,
         Message,
         OpMessage,
         LeadershipVote,
         LeaderConfirmation } from '../trebizond-common/datatypes';
import { BlockChain,
         StateMachine } from '../state-machine-connector/command';
import { ServerNetworkController } from './networkController';
import { checkTextSignature,
         hashObject,
         SignedObject,
         decryptText } from '../trebizond-common/crypto';

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
export abstract class BaseTrebizondServer<Op extends Operation, R extends Result> {

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

    protected topologyPeers: Map<number, string>;
    protected peerKeys: Map<number, string>;
    protected clientKeys: Map<number, string>;

    /**
     * Base constructor to be accessed by children classes,
     * since this class is abstract.
     * @param serverId Numeric identifier for this server.
     * @param topologyPeers Endpoint distribution for the cluster topology.
     *          Map containing the identifiers for the nodes in the cluster,
     *          along with their numeric identifiers.
     * @param externalEndpoint IP address and port onto which the server
     *          will attend client's requests.
     * @param stateMachine State machine onto which the command operations
     *          will be executed. Potentially, a subclass inheriting the
     *          behavior provided by the base StateMachine class.
     */
    constructor(serverId: number, topologyPeers: Map<number, string>,
            peerKeys: Map<number, string>, clientKeys: Map<number, string>,
            externalEndpoint: string, serverPrivateKey: string,
            stateMachine: StateMachine<Op, R>) {
        this.id = serverId;
        this.externalEndpoint = externalEndpoint;
        this.internalEndpoint = topologyPeers.get(serverId)!;
        this.privateKey = serverPrivateKey;
        this.nReplicas = topologyPeers.size;
        this.stateMachine = stateMachine;
        this.topologyPeers = topologyPeers;
        this.peerKeys = peerKeys;
        this.clientKeys = clientKeys;

        this.log = new BlockChain();

        // Initialize the networking layer beneath
        this.networkConnection = new ServerNetworkController(
            this.id, topologyPeers, peerKeys, clientKeys, this.externalEndpoint,
            this.dispatchPeerMessage.bind(this),
            this.dispatchClientOpRequest.bind(this));
    }

    getId(): number {
        return this.id;
    }

    getNReplicas(): number {
        return this.nReplicas;
    }

    getExposedEndpoint(): string {
        return this.externalEndpoint;
    }
    
    /**
     * Submits an operation from a client
     * @param command The command to be managed and applied to the replicated
     *                  state machine by the servers cluster
     */
    public abstract dispatchClientOpRequest(operation: OpMessage<Op>): void;

    /**
     * Reply to a client upon a previously submitted operation
     * @param operationReply The result message to be sent back to the client
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
}

/**
 * Complete implementation of a Trebizond server.
 * In addition of the functionality provided by its parent class, it also
 * implements the atomic broadcast and successive leader rotation algorithms.
 */
export class TrebizondServer<Op extends Operation, R extends Result> extends BaseTrebizondServer<Op, R> {

    private leaderId: number = 0;
    private currentStage: number = 0;
    private votesRegistry = new Map<number, Map<number, SignedObject<LeadershipVote>>>();

    /**
     * @inheritDoc
     */
    constructor(serverId: number, topologyPeers: Map<number, string>,
            peerKeys: Map<number, string>, clientKeys: Map<number, string>,
            externalEndpoint: string, serverPrivateKey: string,
            stateMachine: StateMachine<Op, R>) {
        super(serverId, topologyPeers, peerKeys, clientKeys, externalEndpoint,
            serverPrivateKey, stateMachine);
        this.leaderId = [...topologyPeers.keys()].sort()[0];

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
            // TODO MORE MESSAGE TYPES
        }
    }

    /**
     * @inheritDoc
     */
    public dispatchClientOpRequest(operation: OpMessage<Op>): void {
        // TODO
    }
    
    private readonly LEADER_TIMEOUT = 5000;

    private resetTimeout(timeout = this.LEADER_TIMEOUT) {
        setTimeout(this.leaderTimeout.bind(this), timeout);
    }

    /**
     * This node votes for the replica it thinks to be the prospective
     * next leader, based on the stage number.
     */
    protected leaderTimeout() {
        var nextLeader = ++this.currentStage % this.nReplicas;
        var leaderVote: LeadershipVote = {
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
                && leadership.votes.size >= Math.ceil((2 * this.nReplicas + 1) / 3)) {
            let vote: LeadershipVote = {
                type: 'LeadershipVote',
                vote: leadership.leader.vote,
                epoque: leadership.leader.epoque,
                from: leadership.from
            };
            var nVotes = 0;
            leadership.votes.forEach((value: Uint8Array, key: number) => {
                vote.from = key;
                let voteHash = hashObject(leadership.leader);
                let sourceKey = this.peerKeys.get(key);
                if (sourceKey && decryptText(value, sourceKey) == voteHash) {
                    nVotes++;
                }
            });

            /**
             * Valid leadership confirmation for a stage equal or higher than
             * the current one. Current leader and stage identifiers are updated.
             * Otherwise, the leadership confirmation message is discarded.
             */
            if (nVotes == leadership.votes.size) {
                this.leaderId = leadership.leader.vote;
                this.currentStage = leadership.leader.epoque;
            }
        }
    }

    /**
     * Leadership vote received
     * @param vote Leadership vote for a node and a stage
     */
    private receiveLeadershipVote(signedVote: SignedObject<LeadershipVote>) {
        // Verify whether leadership vote is valid, being destinated
        // to this replica for a stage equal or higher than the
        // current one. Otherwise, the leadership vote message is discarded.
        var vote: LeadershipVote = signedVote.value;
        if (vote.vote == this.id
                && vote.epoque >= this.currentStage
                && !(this.votesRegistry.has(vote.epoque)
                    && this.votesRegistry.get(vote.epoque)!.has(vote.from))) {
            if (!this.votesRegistry.has(vote.epoque)) {
                this.votesRegistry.set(vote.epoque, new Map<number, SignedObject<LeadershipVote>>());
            }
            this.votesRegistry.get(vote.epoque)!.set(vote.from, signedVote);

            /**
             * If the number of votes needed for this replica to proclame itself the leader
             * for a stage equal or higher than the current one has been reached. The current
             * leader and stage identifers are updated and the votes gathered are sent as an
             * evidence to the other replicas.
             */
            if (this.votesRegistry.get(vote.epoque)!.size >= Math.ceil((2 * this.nReplicas + 1) / 3)) {
                var votes = new Map<number, Uint8Array>();
                this.votesRegistry.get(vote.epoque)!.forEach((value: SignedObject<LeadershipVote>, key: number) => {
                    votes.set(key, value.signature);
                });
                var leadershipConfirmation: LeaderConfirmation = {
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
}

/**
 * Extends the functionality provided by the Trebizond complete server,
 * enabling its manipulation for the sake of testing and debugging.
 */
export class OperableTrebizondServer<Op extends Operation, R extends Result> extends TrebizondServer<Op, R> {

    stopped: boolean = false;

    constructor(serverId: number, topologyPeers: Map<number, string>,
            peerKeys: Map<number, string>, clientKeys: Map<number, string>,
            externalEndpoint: string, serverPrivateKey: string,
            stateMachine: StateMachine<Op, R>) {
        super(serverId, topologyPeers, peerKeys, clientKeys, externalEndpoint,
            serverPrivateKey, stateMachine);
    }
}
