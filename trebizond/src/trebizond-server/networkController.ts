/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 * 
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 * 
 * Javier Fernández-Bravo Peñuela
 * 
 * trebizond-server/networkController.ts
 */

import { Message,
         Envelope,
         OpMessage,
         SignedOpMessage,
         Reply } from '../trebizond-common/datatypes';
import { checkObjectSignature,
         signObject,
         SignedObject } from '../trebizond-common/crypto';
import { Deferred as QPromise } from '../trebizond-common/deferred';
import { uuidv4 } from '../trebizond-common/util';
import { networkInterfaces } from 'os';
import * as zeromq from 'zeromq';
import * as dns from 'dns';

/**
 * Provides marshalling and unmarshalling functionality for a specific
 * NetworkController extending this class. In additino, it specifies
 * the headers for those functions any NetworkController worth such a
 * categorization must support and implement.
 */
export abstract class NetworkController {

    /**
     * Socket used for sending request messages to peer servers in the cluster.
     */
    protected routerSocket!: zeromq.Socket;

    /**
     * Socket used for receiving requests from peer servers in the cluster
     * and answer them via reply messages.
     */
    protected dealerSocket!: zeromq.Socket;

    /**
     * Socket used for receiving commands from clients and answering them
     * upon their commitment or refusal
     */
    protected replySocket!: zeromq.Socket;

    /**
     * Marshall a message into an array of strings so that it can be
     * sent by means of a ZeroMQ socket.
     * @param msg The message to marshall
     * @param from The source of the message
     * @param to the recipient of the message
     * @returns The marshalled representation of a message, apt for
     *              its sending by means of a ZeroMQ socket
     */
    marshallMessage(msg: SignedObject<Message>, from: number, to?: number, uuid: string = uuidv4()): string[] {
        var marshall: Array<string> = [];
        marshall.push('');
        marshall.push(from.toString());
        marshall.push(to != null ? to.toString(): '');
        marshall.push(msg.value.type);
        marshall.push(uuid);
        marshall.push(JSON.stringify(msg));
        return marshall;
    }

    /**
     * Unmarshall a message from its network representation.
     * @param marshall The marshalled form of the message,
     *                  as it has ben retrieved from the network.
     * @returns The message itself, boxed into an envelope which
     *              contains data related to its delivery
     */
    unmarshallMessage(marshall: string[]): Envelope<Message> {
        var msg: SignedObject<Message>;
        var ids: Array<string> = [];
        var msgType: string;
        var uuid: string;
        let n = 0;
        while (marshall[n].length > 0) {
            ids.push(marshall[n++].toString());
        }
        ids.reverse();
        ids.unshift(marshall[++n].toString());
        ids.push(marshall[++n].toString());
        msgType = marshall[++n].toString();
        uuid = marshall[++n].toString();
        msg = JSON.parse(marshall[++n].toString());
        var envelope: Envelope<Message> = {
            ids: ids,
            type: msgType,
            serialUUID: uuid,
            msg: msg
        };
        return envelope;
    }

    protected static readonly TRANSPORT_PROTOCOL: string = 'tcp';
    protected static readonly PROTOCOL_PREFIX: string = NetworkController.TRANSPORT_PROTOCOL + '://';

    /**
     * Sends a message of any type to another server in the cluster.
     * @param msg Message to be sent
     * @param to Identifier of the message's recipient
     */
    public abstract sendMessage(msg: Message, to: number): void;

    /**
     * Sends a reply message to a client
     * regarding its operation request outcome
     * @param msg The operation reply message to be sent
     */
    public abstract replyClientOperation(msg: Message): void;

    /**
     * Manages a message received from another peer server in the cluster.
     * To be used as a callback function in ZeroMQ on 'message' events.
     */
    protected abstract dispatchMessage(): void;

    /**
     * Manages a message received from a client.
     * To be used as a callback function in ZeroMQ on 'message' events.
     */
    protected abstract dispatchOpRequest(): void;
}

/**
 * Provides networking connectivity and communications in the context
 * of an peer-to-peer nodes topology
 */
export class ServerNetworkController extends NetworkController {

    /**
     * this server endpoint, also working as an identifier
     */
    protected id: number;

    /**
     * other peers endpoints, also working as their respective identifiers
     */
    protected topologyPeers: Map<number, string>;

    /**
     * other peers public keys, for checking digital signatures
     */
    protected peerKeys: Map<number, string>;

    /**
     * clients public keys, for checking digital signatures
     */
    protected clientKeys: Map<number, string>;

    /**
     * function provided by the server instantiating this controller,
     * to be called when a request message from another server is received
     */
    protected onMessageCallback!: (message: SignedObject<Message>) => void|any;
    protected onRequestCallback!: (message: SignedObject<OpMessage<any>>) => void|any;

    /**
     * NetworkController class constructor
     * @param serverId Endpoint for this server, also working as an identifier
     * @param topologyPeers Endpoint distribution for the peer nodes in the
     *                      cluster topology. This server must have been
     *                      previously removed from the array
     * @param externalEndpoint IP address and port onto which the server
     *                          will attend client's requests
     * @param onMessageCallback Function to be executed when a message
     *                          of any type destinated to this server is received
     * @param onRequestCallback Function to be executed when a client operation
     *                          request is received by this server
     */
    constructor(id: number, topologyPeers: Map<number, string>,
            peerKeys: Map<number, string>,
            clientKeys: Map<number, string>,
            externalEndpoint: string,
            onMessageCallback: (message: SignedObject<Message>) => void|any,
            onRequestCallback: (message: SignedObject<OpMessage<any>>) => void|any) {
        super();
        this.id = id;
        this.topologyPeers = topologyPeers;
        this.peerKeys = peerKeys;
        this.clientKeys = clientKeys;

        this.bindInternalSockets(topologyPeers, onMessageCallback);
        this.bindExternalSocket(externalEndpoint, onRequestCallback);
    }

    private bindInternalSockets(topologyPeers: Map<number, string>,
            onMessageCallback: (msg: SignedObject<Message>) => void|any): void {
        var internalEndpoint: string = this.topologyPeers.get(this.id)!;
        this.topologyPeers.delete(this.id);

        this.routerSocket = zeromq.socket('router');
        //this.routerSocket.setsocketopt(/* ZMQ_ROUTER_MANDATORY */ 33, 1);
        this.routerSocket.on('error', this.manageDeliveryError.bind(this));
        for (const peer of topologyPeers.values()) {
            this.routerSocket.connect(NetworkController.PROTOCOL_PREFIX + peer);
            console.log('Connected to endpoint ' + peer);
        }

        this.dealerSocket = zeromq.socket('dealer');
        this.dealerSocket.identity = this.id.toString();
        this.dealerSocket.on('message', this.dispatchMessage.bind(this));
        this.setOnMessageCallback(onMessageCallback);

        resolveHostnameToNetworkAddress(internalEndpoint).then((endpointAddress: string) => {
            const networkInterface: string = identifyEndpointInterface(endpointAddress);
            console.log('Internal endpoint ' + internalEndpoint +
                ' (' + endpointAddress + ') maps to network interface ' + networkInterface);
            this.dealerSocket.bindSync(NetworkController.PROTOCOL_PREFIX + endpointAddress);
        });
    }

    private bindExternalSocket(externalEndpoint: string,
        onRequestCallback: (msg: SignedObject<OpMessage<any>>) => void|any): void {
            this.replySocket = zeromq.socket('rep');
            this.replySocket.on('message', this.dispatchOpRequest.bind(this));
            this.setOnRequestCallback(onRequestCallback);

            resolveHostnameToNetworkAddress(externalEndpoint).then((endpointAddress: string) => {
                const networkInterface = identifyEndpointInterface(endpointAddress);
                console.log('External endpoint ' + externalEndpoint +
                    ' (' + endpointAddress + ') maps to network interface ' + networkInterface);
                this.replySocket.bind(NetworkController.PROTOCOL_PREFIX + endpointAddress);
            });
    }

    /**
     * @inheritDoc
     */
    public sendMessage(msg: Message, to: number): void {
        console.log('Server ' + this.id + ' sending ' + msg.type + ' message to ' + to);
        var signed = signObject(msg, this.peerKeys.get(this.id)!) as SignedObject<Message>;
        var marshalled = this.marshallMessage(signed, this.id, to);
        marshalled.unshift(to.toString());

        this.routerSocket.send(marshalled);
    }

    /**
     * Sends a message of any type to a subset
     * of peer servers in the cluster.
     * @param msg Message to be sent
     * @param to Identifiers of the request's recipients
     */
    public sendMulticast(msg: Message, to: number[]): void {
        to.forEach((recipient) => {
            this.sendMessage(msg, recipient);
        });
    }

    /**
     * Sends a message of any type to every peer server in the cluster.
     * @param msg Request message to be sent
     * @param timeout Optional timeout to be triggered when it expires without
     *                  a reply having been received
     */
    public sendBroadcast(msg: Message): void {
        return this.sendMulticast(msg, [...this.topologyPeers.keys()]);
    }

    /**
     * @inheritDoc
     */
    public replyClientOperation(msg: Message): void {
        console.log('Server ' + this.id + ' sending ' + msg.type + ' reply message to client');
        var signed = signObject(msg, this.peerKeys.get(this.id)!) as SignedObject<Message>;
        this.replySocket.send(JSON.stringify(signed));
    }

    /**
     * @inheritDoc
     */
    protected dispatchMessage(...args: string[]): void {
        const message: Envelope<Message> = this.unmarshallMessage(args);
        console.log('Server ' + message.ids[message.ids.length - 1] + ': Received message of type ' + message.type + ' from ' + message.ids[0]);

        // Check message validity before dispatching it
        var sourceKey = this.peerKeys.get(message.msg.value.from);
        if (sourceKey && checkObjectSignature(message.msg, sourceKey)
                && message.type === message.msg.value.type) {
            this.onMessageCallback(message.msg);
        }
    }

    public getOnMessageCallback(): (message: SignedObject<Message>) => void|any {
        return this.onMessageCallback;
    }

    public setOnMessageCallback(onMessage: (msg: SignedObject<Message>) => void|any) {
        this.onMessageCallback = onMessage;
    }

    /**
     * @inheritDoc
     */
    protected dispatchOpRequest(...args: string[]): void {
        const message: SignedObject<OpMessage<any>> = JSON.parse(args.toString());
        console.log('Server ' + this.id + ': Received operation request message from client ' + message.value.from);

        // Check message validity before dispatching it
        var sourceKey = this.peerKeys.get(message.value.from);
        if (sourceKey && checkObjectSignature(message, sourceKey)) {
            this.onRequestCallback(message);
        }
    }

    public getOnRequestCallback(): (msg: SignedObject<OpMessage<any>>) => void|any {
        return this.onRequestCallback;
    }

    public setOnRequestCallback(onRequest: (msg: SignedObject<OpMessage<any>>) => void|any) {
        this.onRequestCallback = onRequest;
    }

    /**
     * Manages an error in the delivery of a message across the network.
     */
    protected manageDeliveryError(...args: string[]): void {
        const message = this.unmarshallMessage(args);
        console.log('Server ' + message.ids[0] + ': Failed to send message of type ' + message.type + ' to ' + message.ids[message.ids.length - 1]);
    }
}

function resolveHostnameToNetworkAddress(endpoint: string): Promise<string> {
    var p = new QPromise<string>();

    let i: number;
    let endpointPort: number;
    let endpointAddress: string;

    if ((i = endpoint.lastIndexOf(':')) >= 0) {
        endpointAddress = endpoint.slice(0, i);
        endpointPort = Number(endpoint.slice(i + 1));
    } else {
        endpointAddress = endpoint;
        endpointPort = 0;
    }
    dns.lookup(endpointAddress, (err, address, family) => {
        if (err === null && address !== undefined && family !== undefined) {
            endpointAddress = address;
        }
        endpointAddress = endpointAddress + (endpointPort > 0 ? ':' + endpointPort : '');
        p.resolve(endpointAddress);
    });

    return p.promise;
}

function identifyEndpointInterface(endpoint: string): string {
    var endpointInterface: string = endpoint;
    var osNetworkInterfaces = networkInterfaces();
    for (const nwif in osNetworkInterfaces) {
        for (const nwAddr of osNetworkInterfaces[nwif]) {
            const address = nwAddr.address;
            if (endpoint.startsWith(address)) {
                endpointInterface = nwif;
                break;
            }
        }
    }
    return endpointInterface;
}

export interface SynchronousNetworkController {

    /**
     * Sends a request message of any type to another server in the cluster.
     * @param req Request message to be sent
     * @param to Identifier of the request message's recipient
     * @param timeout Optional timeout to be triggered when it expires without
     *                  a reply having been received
     * @returns Promise to the deferred reply to the request message.
     *              It can be resolved in three ways:
     *          - Success: A reply to the message was received. In such a case,
     *              the promis resolves to the reply message.
     *          - Error: The request message could not be properly delivered
     *              (ex., the destination host was found to be unreachable).
     *              In such a case, the promise resolves to the error
     *              description.
     *          - Error: A timeout was provided, and it expires without
     *              a reply to the request message having been received.
     *              In such a case, the promise resolves to the error
     *              description.
     */
    sendMessageSync(req: Message, to: number, timeout?: number): QPromise<Envelope<Reply>>;

    /**
     * Sends a request message of any type to a subset 
     * of peer servers in the cluster.
     * @param req Request message to be sent
     * @param to Identifiers of the request message's recipients
     * @param timeout Optional timeout to be triggered when it expires
     *                  without a reply having been received
     * @returns Array of promises to the deferred replies to the request.
     *              It is sorted to match the recipientIds array.
     *              Each one of these promises can be resolved in three ways:
     *          - Success: A reply to the request was received. In such a case,
     *              the promise resolves to the reply message.
     *          - Error: The request message could not be properly delivered
     *              (ex., the destination host was found to be unreachable).
     *              In such a case, the promise resolves to the error
     *              description.
     *          - Error: A tiemout was provided, and it expires without
     *              a reply to the request message having been received.
     *              In such a case, the promise resolves to the error
     *              description.
     */
    sendMulticastSync(req: Message, to: number[], timeout?: number): QPromise<Envelope<Reply>>[];

    /**
     * Sends a request message of any type to every peer server in the cluster.
     * @param req Request message to be sent
     * @param timeout Optional timeout to be triggered when it expires without
     *                  a reply having been received
     * @returns Array of promises to the deferred replies to the request.
     *              It is sorted accordingly to the topologyPeers class property.
     *              Each one of these promises can be resolved in three ways:
     *          - Success: A reply to the request was received. In such a case,
     *              the promise resolves to the reply message.
     *          - Error: The request message could not be properlyd elivered
     *              (ex., the destination host was found to be unreachable).
     *              In sucha a case, the promise resolves to the error
     *              description.
     *          - Error: A tiemout was provided, and it expires without
     *              a reply to the request message having been received.
     *              In such a case, the promise resolves to the error
     *              description.
     */
    sendBroadcastSync(req: Message, timeout?: number): QPromise<Envelope<Reply>>[];

    /**
     * Sends a reply of any type to another server in the cluster.
     * @param reply Reply message to be sent
     * @param recipientId Identifier of the server to whom send the reply
     */
    sendReply(msg: Reply, to: number): void;
}

export class SynchronousServerNetworkController extends ServerNetworkController
                                                implements SynchronousNetworkController {

    /**
     * promises to the replies to be received from peers as answers to
     * previously sent requests, when they will be resolved
     */
    private pendingReplies: Map<string, QPromise<Envelope<Reply>>>;

    /**
     * @inheritDoc
     */
    constructor(id: number, topologyPeers: Map<number, string>,
            peerKeys: Map<number, string>, clientKeys: Map<number, string>,
            externalEndpoint: string,
            onMessageCallback: (message: SignedObject<Message>) => void|any,
            onCommandCallback: (message: SignedObject<OpMessage<any>>) => void|any) {
        super(id, topologyPeers, peerKeys, clientKeys, externalEndpoint, onMessageCallback, onCommandCallback);
        this.pendingReplies = new Map<string, QPromise<Envelope<Reply>>>();
    }

    /**
     * @inheritDoc
     */
    public sendMessageSync(req: Message, to: number, timeout?: number): QPromise<Envelope<Reply>> {
        console.log('Server ' + this.id + ' sending ' + req.type + ' message to ' + to);
        var signed = signObject(req, this.peerKeys.get(this.id)!) as SignedObject<Message>;
        var marshalled = this.marshallMessage(signed, this.id, to);
        marshalled.unshift(to.toString());
        
        var p = new QPromise<Envelope<Reply>>();
        var envelopeSerialUUID = marshalled[marshalled.length - 2];
        this.pendingReplies.set(envelopeSerialUUID, p);
        
        if (timeout != null) {
            setTimeout(() => {
                if (!p.isResolved()) {
                    p.reject('Timeout exceeded');
                    this.pendingReplies.delete(envelopeSerialUUID);
                }
            }, timeout);
        }
        
        this.routerSocket.send(marshalled);
        
        return p;
    }

    /**
     * @inheritDoc
     */
    public sendMulticastSync(req: Message, to: number[], timeout?: number): QPromise<Envelope<Reply>>[] {
        var p: Array<QPromise<Envelope<Reply>>> = [];
        for (const recipient of to) {
            p.push(this.sendMessageSync(req, recipient, timeout));
        }
        return p;
    }

    /**
     * @inheritDoc
     */
    public sendBroadcastSync(req: Message, timeout?: number): QPromise<Envelope<Reply>>[] {
        return this.sendMulticastSync(req, [...this.topologyPeers.keys()], timeout);
    }

    /**
     * @inheritDoc
     */
    public sendReply(msg: Reply, to: number): void {
        console.log('Server ' + this.id + ' replies with ' + msg.type + ' message to ' + to);
        const marshalled = this.marshallMessage(signObject(msg, this.peerKeys.get(this.id)!) as SignedObject<Reply>, this.id, to, msg.serialUUID);
        marshalled.unshift(to.toString());
        this.routerSocket.send(marshalled);
    }
    
    /**
     * @inheritDoc
     */
    protected dispatchMessage(...args: string[]): void {
        const message = this.unmarshallMessage(args);
        console.log('Server' + message.ids[message.ids.length - 1] + ': Received message of type ' + message.type + ' from ' + message.ids[0]);

        // Check message validity before dispatching it
        var sourceKey = this.peerKeys.get(message.msg.value.from);
        if (sourceKey && checkObjectSignature(message.msg, sourceKey)
                && message.type == message.msg.value.type) {
            if (!this.isReplyMessage(message)) {
                this.onMessageCallback(message.msg);
            } else {
                this.dispatchReplyMessage(message as Envelope<Reply>);
            }
        }
    }

    /**
     * Manages a reply message received in response to a previously sent request.
     * Retrieve the promise it is bounded to and resolve it as a success, providing
     * the message received as the resolution parameter.
     */
    protected dispatchReplyMessage(message: Envelope<Reply>): void {
        var p = this.pendingReplies.get(message.serialUUID);
        if (p != null && p.isPending()) {
            p.resolve(message);
            this.pendingReplies.delete(message.serialUUID);
        }
    }

    protected isReplyMessage(message: Envelope<Message>): boolean {
        return this.pendingReplies.has(message.serialUUID);
    }

    /**
     * @inheritDoc
     */
    protected manageDeliveryError(...args: string[]): void {
        const message = this.unmarshallMessage(args);
        console.log('Server ' + message.ids[0] + ': Failed to send message of type ' + message.type + ' to ' + message.ids[message.ids.length - 1]);
        var p = this.pendingReplies.get(message.serialUUID);
        if (p != null && p.isPending()) {
            p.reject('Delivery error');
            this.pendingReplies.delete(message.serialUUID);
        }
    }
}
