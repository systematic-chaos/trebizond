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
         Envelope,
         LeadershipVote } from '../trebizond-common/datatypes';
import { BlockChain,
         StateMachine } from '../state-machine-connector/command';
import { ServerNetworkController } from './networkController';
import { SignedObject } from '../trebizond-common/crypto';

/**
 * Base class for a Trebizond server.
 * In addition to complete networking functionality, it provides the
 * implementation for the atomic broadcast algorithm, common to all nodes.
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

        this.log = new BlockChain();

        // Initialize the networking layer beneath
        this.networkConnection = new ServerNetworkController(
            this.id, topologyPeers, peerKeys, clientKeys, this.externalEndpoint,
            this.dispatchMessage.bind(this),
            (msg: string[]) => {
                console.log(msg.toString());
                this.submitClientOperation(JSON.parse(msg.toString()));
            })
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
    public abstract submitClientOperation(operation: Op): void;

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
     * @param message Networking envelope object containing a message of any
     *                  type received from another server in the cluster
     */
    protected dispatchMessage(message: Envelope<Message>): void {
        switch (message.type) {
            default:
                break;
        }
    }

    /**
     * Sends a message of any type to another replica in the cluster.
     * @param message The message to be sent
     * @param recipientId Identifier of the request's recipient
     */
    private sendUnicast(message: Message, recipientId: number): void {
        this.networkConnection.sendMessage(message, recipientId);
    }

    /**
     * Sends a message of any type to a subset of peer replicas in the cluster.
     * @param message The message to be sent
     * @param recipientIds Identifiers of the request's recipients
     */
    private sendMulticast(message: Message, recipientIds: number[]): void {
        this.networkConnection.sendMulticast(message, recipientIds);
    }

    /**
     * Sends a message of any type to every peer replica in the cluster.
     * @param message The message to be sent
     */
    private sendBroadcast(message: Message): void {
        this.networkConnection.sendBroadcast(message);
    }
}

/**
 * Complete implementation of a Trebizond server.
 * In addition of the functionality provided by its parent class
 * (@class BaseTrebizondServer<Op, R>, mainly the atomic broadcast algorithm),
 * it also implements the successive leader rotation algorithm.
 */
export class TrebizondServer<Op extends Operation, R extends Result> extends BaseTrebizondServer<Op, R> {

    protected leaderId: number;
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
        setTimeout(() => {}, 5000);
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
