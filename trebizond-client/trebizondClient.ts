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

import { Cipher } from '../trebizond-common/crypto';
import { Deferred as QPromise } from '../trebizond-common/deferred';
import { uuidv4 } from '../trebizond-common/util';
import { Operation,
         Result,
         TrebizondOperation } from '../trebizond-common/datatypes';
import * as zeromq from 'zeromq';

export class TrebizondClient<Op extends Operation> {

    private clientId: number;
    private clientEndpoint: string;
    private privateKey: string;

    // server id, [server endpoint, server public key]
    private serversTopology: Map<number, [string, string]>;

    private cipher: Cipher;

    private requestSockets: Map<number, zeromq.Socket>;

    protected static readonly TRANSPORT_PROTOCOL: string = 'tcp';
    protected static readonly PROTOCOL_PREFIX: string = TrebizondClient.TRANSPORT_PROTOCOL + '://';

    constructor(client: [number, string, string],
            serversTopology: Map<number, [string, string]>) {
        this.clientId = client[0];
        this.clientEndpoint = client[1];
        this.privateKey = client[2];
        this.serversTopology = serversTopology;

        this.cipher = new Cipher(this.privateKey);
        this.requestSockets = new Map<number, zeromq.Socket>();
        this.connectToServers(serversTopology, this.requestSockets);
    }

    private connectToServers(serverTopology: Map<number, [string, any]>,
            requestSockets: Map<number, zeromq.Socket>): number {
        serverTopology.forEach((value: [string, any], key: number) => {
            if (!value[0].startsWith(TrebizondClient.PROTOCOL_PREFIX)) {
                let serverEndpoint = TrebizondClient.PROTOCOL_PREFIX + value[0];
                serverTopology.set(key, [serverEndpoint, value[1]]);
                let serverSocket = zeromq.createSocket('req');
                try {
                    serverSocket.connect(serverEndpoint);
                    console.log('Connected to cluster endpoint ' + key +
                        ' (' + serverEndpoint + ')');
                    
                    serverSocket.on('message', (msg: any) => {});
                    requestSockets.set(key, serverSocket);
                } catch(ex) {
                    console.error('Failed to connect to cluster endpoint ' +
                        key + ' (' + serverEndpoint + ')');
                }
            }
        });
        return requestSockets.size;
    }

    public sendCommand(command: Op): Promise<Result> {
        var p = new QPromise<Result>();
        this.sendOperationRequest(this.generateOperationFromCommand(command));
        // TODO SEND OP
        return p.promise;
    }

    private generateOperationFromCommand(command: Op): TrebizondOperation<Op> {
        return {
            operation: command,
            uuid: uuidv4(),
            timestamp: new Date()
        };
    }

    private sendOperationRequest(operation: TrebizondOperation<Op>): void {
        // TODO FIX ID'S
        var currentServerEndpoint: String = this.serversTopology.get(this.clientId)![0];
        console.log('Sending operation to ' + this.clientId +
            '(' + currentServerEndpoint + ')');
        var op = operation.operation;
        console.log(JSON.stringify(op));
        this.requestSockets.get(this.clientId)!.send(JSON.stringify(this.cipher.signObject(operation)));
    }
}
