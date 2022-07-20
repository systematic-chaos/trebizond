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
         Reply,
         Operation } from '../trebizond-common/datatypes';
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
abstract class NetworkController {

    /**
     * Sockets used for sending request messages to peer servers in the cluster.
     * TODO MULTIPLE ROUTER SOCKETS?
     */
    protected routerSocket: zeromq.Socket;

    /**
     * Socket used for receiving requests from peer servers in the cluster
     * and answer them via reply messages.
     */
    protected dealerSocket: zeromq.Socket;

    /**
     * Socket used for receiving commands from clients and answering them
     * upon their commitment or refusal
     */
    protected replySocket: zeromq.Socket;

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
        const marshall: string[] = [];
        marshall.push('');
        marshall.push(from.toString());
        marshall.push(to ? to.toString() : '');
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
        const ids: string[] = [];
        let n = 0;
        while (marshall[n].length > 0) {
            ids.push(marshall[n++].toString());
        }
        ids.reverse();
        ids.unshift(marshall[++n].toString());
        ids.push(marshall[++n].toString());
        const msgType = marshall[++n].toString();
        const uuid = marshall[++n].toString();
        const msg: SignedObject<Message> = JSON.parse(marshall[++n].toString());
        return {
            ids,
            type: msgType,
            serialUUID: uuid,
            msg
        };
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
class ServerNetworkController extends NetworkController {

    /**
     * this server endpoint, also working as an identifier
     */
    protected id: number;

    /**
     * other peers endpoints, also working as their respective identifiers
     */
    protected peers: Record<number, ServerDefinition>;

    /**
     * the private key of this server for signing messages
     */
    protected privateKey: string;

    /**
     * clients public keys, for checking digital signatures
     */
    protected clientKeys: Record<number, Buffer>;

    /**
     * function provided by the server instantiating this controller,
     * to be called when a request message from another server is received
     */
    protected onMessageCallback!: (message: SignedObject<Message>) => void;
    protected onRequestCallback!: (message: SignedObject<OpMessage<Operation>>) => void;

    /**
     * NetworkController class constructor
     * @param id Endpoint for this server, also working as an identifier.
     * @param peers Endpoint distribution for the peer nodes in the
     *          cluster topology. This server must have been
     *          previously removed from the array.
     * @param externalEndpoint IP address and port onto which the server
     *          will attend client's requests.
     * @param privateKey Private key of this server for signing messages
     *          to be sent and decrypting messages received.
     * @param clientKeys Identifiers of the authorized clients along with their
     *          public keys.
     * @param onMessageCallback Function to be executed when a message
     *          of any type destinated to this server is received.
     * @param onRequestCallback Function to be executed when a client operation
     *          request is received by this server.
     */
    constructor(id: number, peers: Record<number, ServerDefinition>,
            externalEndpoint: string, privateKey: string,
            clientKeys: Record<number, Buffer>,
            onMessageCallback: (message: SignedObject<Message>) => void,
            onRequestCallback:(message: SignedObject<OpMessage<Operation>>) => void) {
        super();
        this.id = id;
        this.peers = peers;
        this.clientKeys = clientKeys;
        this.privateKey = privateKey;

        this.bindInternalSockets(peers, onMessageCallback);
        this.bindExternalSocket(externalEndpoint, onRequestCallback);
    }

    private bindInternalSockets(peerTopology: Record<number, ServerDefinition>,
            onMessageCallback: (msg: SignedObject<Message>) => void): void {
        const internalEndpoint = peerTopology[this.id].endpoint;
        delete peerTopology[this.id];

        this.routerSocket = zeromq.socket('router');
        //this.routerSocket.setsocketopt(/* ZMQ_ROUTER_MANDATORY */ 33, 1);
        this.routerSocket.on('error', this.manageDeliveryError.bind(this));
        for (const peer of Object.values(peerTopology)) {
            this.routerSocket.connect(NetworkController.PROTOCOL_PREFIX + peer.endpoint);
            console.log('Connected to endpoint ' + peer.endpoint);
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
            onRequestCallback: (msg: SignedObject<OpMessage<Operation>>) => void): void {
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
        const signed = signObject(msg, this.privateKey) as SignedObject<Message>;
        const marshalled = this.marshallMessage(signed, this.id, to);
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
     */
    public sendBroadcast(msg: Message): void {
        return this.sendMulticast(msg, Object.keys(this.peers).map(Number));
    }

    /**
     * @inheritDoc
     */
    public replyClientOperation(msg: Message): void {
        console.log('Server ' + this.id + ' sending ' + msg.type + ' reply message to client');
        const signed = signObject(msg, this.privateKey) as SignedObject<Message>;
        this.replySocket.send(JSON.stringify(signed));
    }

    /**
     * @inheritDoc
     */
    protected dispatchMessage(...args: string[]): void {
        const message: Envelope<Message> = this.unmarshallMessage(args);
        console.log('Server ' + message.ids[message.ids.length - 1] + ': Received message of type ' + message.type + ' from ' + message.ids[0]);

        // Check message validity before dispatching it
        const sourceKey = this.peers[message.msg.value.from].publicKey;
        if (sourceKey && checkObjectSignature(message.msg, sourceKey)
                && message.type === message.msg.value.type) {
            this.onMessageCallback(message.msg);
        }
    }

    public getOnMessageCallback(): (message: SignedObject<Message>) => void {
        return this.onMessageCallback;
    }

    public setOnMessageCallback(onMessage: (msg: SignedObject<Message>) => void) {
        this.onMessageCallback = onMessage;
    }

    /**
     * @inheritDoc
     */
    protected dispatchOpRequest(...args: string[]): void {
        const message: SignedObject<OpMessage<Operation>> = JSON.parse(args.toString());
        console.log('Server ' + this.id + ': Received operation request message from client ' + message.value.from);

        // Check message validity before dispatching it
        const sourceKey = this.clientKeys[message.value.from];
        if (sourceKey && checkObjectSignature(message, sourceKey)) {
            this.onRequestCallback(message);
        }
    }

    public getOnRequestCallback(): (msg: SignedObject<OpMessage<Operation>>) => void {
        return this.onRequestCallback;
    }

    public setOnRequestCallback(onRequest: (msg: SignedObject<OpMessage<Operation>>) => void) {
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

    return new Promise<string>(resolve => {
        dns.lookup(endpointAddress, (err, address, family) => {
            if (!err && address && family) {
                endpointAddress = address;
            }
            if (endpointPort > 0) {
                endpointAddress += `:${endpointPort}`;
            }
            resolve(endpointAddress);
        });
    });
}

function identifyEndpointInterface(endpoint: string): string {
    let endpointInterface = endpoint;
    const osNetworkInterfaces = networkInterfaces();
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

interface SynchronousNetworkController {

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
    sendReply(reply: Reply, recipientId: number): void;
}

class SynchronousServerNetworkController extends ServerNetworkController
                                                implements SynchronousNetworkController {

    /**
     * promises to the replies to be received from peers as answers to
     * previously sent requests, when they will be resolved
     */
    private pendingReplies: Record<string, QPromise<Envelope<Reply>>>;

    /**
     * @inheritDoc
     */
    constructor(id: number, peers: Record<number, ServerDefinition>,
            externalEndpoint: string, privateKey: string,
            clientKeys: Record<number, Buffer>,
            onMessageCallback: (message: SignedObject<Message>) => void,
            onCommandCallback: (message: SignedObject<OpMessage<Operation>>) => void) {
        super(id, peers, externalEndpoint, privateKey, clientKeys, onMessageCallback, onCommandCallback);
        this.pendingReplies = {};
    }

    /**
     * @inheritDoc
     */
    public sendMessageSync(req: Message, to: number, timeout?: number): QPromise<Envelope<Reply>> {
        console.log('Server ' + this.id + ' sending ' + req.type + ' message to ' + to);
        const signed = signObject(req, this.privateKey) as SignedObject<Message>;
        const marshalled = this.marshallMessage(signed, this.id, to);
        marshalled.unshift(to.toString());

        const p = new QPromise<Envelope<Reply>>();
        const envelopeSerialUUID = marshalled[marshalled.length - 2];
        this.pendingReplies[envelopeSerialUUID] = p;

        if (timeout) {
            setTimeout(() => {
                if (!p.isResolved()) {
                    p.reject('Timeout exceeded');
                    delete this.pendingReplies[envelopeSerialUUID];
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
        const p: Array<QPromise<Envelope<Reply>>> = [];
        to.forEach(recipient => p.push(this.sendMessageSync(req, recipient, timeout)));
        return p;
    }

    /**
     * @inheritDoc
     */
    public sendBroadcastSync(req: Message, timeout?: number): QPromise<Envelope<Reply>>[] {
        return this.sendMulticastSync(req, Object.keys(this.peers).map(Number), timeout);
    }

    /**
     * @inheritDoc
     */
    public sendReply(msg: Reply, to: number): void {
        console.log('Server ' + this.id + ' replies with ' + msg.type + ' message to ' + to);
        const marshalled = this.marshallMessage(signObject(
            msg, this.privateKey) as SignedObject<Reply>, this.id, to, msg.serialUUID);
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
        const sourceKey = this.peers[message.msg.value.from].publicKey;
        if (sourceKey && checkObjectSignature(message.msg, sourceKey)
                && message.type === message.msg.value.type) {
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
        const p = this.pendingReplies[message.serialUUID];
        if (p && p.isPending()) {
            p.resolve(message);
            delete this.pendingReplies[message.serialUUID];
        }
    }

    protected isReplyMessage(message: Envelope<Message>): boolean {
        return message.serialUUID in this.pendingReplies;
    }

    /**
     * @inheritDoc
     */
    protected manageDeliveryError(...args: string[]): void {
        const message = this.unmarshallMessage(args);
        console.log('Server ' + message.ids[0] + ': Failed to send message of type ' + message.type + ' to ' + message.ids[message.ids.length - 1]);
        const p = this.pendingReplies[message.serialUUID];
        if (p && p.isPending()) {
            p.reject('Delivery error');
            delete this.pendingReplies[message.serialUUID];
        }
    }
}

interface ServerDefinition {
    id?: number,
    endpoint: string,
    publicKey: Buffer
}

export {
    ServerNetworkController, SynchronousNetworkController, SynchronousServerNetworkController,
    ServerDefinition };
