/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 * 
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 * 
 * Javier Fernández-Bravo Peñuela
 * 
 * trebizond-client/trebizondRedisClient.ts
 */

import { Cipher } from '../trebizond-common/crypto';
import { uuidv4 } from '../trebizond-common/util';
import { TrebizondOperation } from '../trebizond-common/datatypes';
import { RedisOperation,
         RedisOperator } from '../redis-state-machine/redisCommand';
import * as fs from 'fs';
import * as zeromq from 'zeromq';

 if (process.argv.length != 3) {
     console.error('usage: nodejs trebizondRedisClient.js <serversFile>');
     process.exit(1);
 }

let serversFile: string = process.argv[2];
let servers: string[] = fs.readFileSync(serversFile, 'utf-8').split('\n').filter(Boolean);
var serversTopology = new Map<number, string>();
for (let n = 0; n < servers.length; n++) {
    serversTopology.set(n + 1, 'tcp://' + servers[n]);
}

const secretKey: string = '5678#';
var cipher: Cipher = new Cipher(secretKey);

var requestSocket: zeromq.Socket = zeromq.createSocket('req');
var currentServerId: number;
var currentServerEndpoint: string;
try {
    connectToServer(1);
} catch(ex) {
    console.error(ex);
    process.exit(2);
}

requestSocket.on('message', (msg: any) => {
});

let A: number = 0;
let B: number = 0;

var nextRequest: TrebizondOperation<RedisOperation> = generateRedisOperation();
sendOperationRequest(nextRequest);

function generateRedisOperation(): TrebizondOperation<RedisOperation> {
    return generateOperationFromCommand(generateRedisCommand());
}

function generateRedisCommand(): RedisOperation {
    var newCommand: any = {
        value: Math.floor(Math.random() * 10000)
    };
    if (Math.floor(Math.random() * 11 / 10) == 1) {
        newCommand.key = 'A';
        if (A == 0) {
            newCommand.operator = RedisOperator.assign;
        } else {
            newCommand.operator = Math.floor(Math.random() * 6) > 4 ? RedisOperator.assign : RedisOperator.add;
        }
        switch (newCommand.operator) {
            case RedisOperator.assign:
                A = newCommand.value;
                break;
            case RedisOperator.add:
                A += newCommand.value;
                break;
        }
    } else {
        newCommand.key = 'B';
        if (B == 0) {
            newCommand.operator = RedisOperator.assign;
        } else {
            newCommand.operator = Math.floor(Math.random() * 6) > 4 ? RedisOperator.assign : RedisOperator.add;
        }
        switch (newCommand.operator) {
            case RedisOperator.assign:
                B = newCommand.value;
                break;
            case RedisOperator.add:
                B += newCommand.value;
                break;
        }
    }
    return new RedisOperation(newCommand.key, newCommand.operator, newCommand.value);
}

function generateOperationFromCommand<Op>(command: Op): TrebizondOperation<Op> {
    return {
        operation: command,
        uuid: uuidv4(),
        timestamp: new Date()
    };
}

function sendOperationRequest(operation: TrebizondOperation<RedisOperation>): void {
    console.log('Sending operation to ' + currentServerId +
        '(' + currentServerEndpoint + ')');
    var op = operation.operation;
    console.log(op.key + op.operator + op.value);
    requestSocket.send(JSON.stringify(cipher.signObject(operation)));
}

function connectToServer(serverId: number, disconnect: boolean = false): void {
    if (disconnect) {
        requestSocket.disconnect(currentServerEndpoint);
    }

    currentServerId = serverId;
    currentServerEndpoint = serversTopology.get(currentServerId)!;
    try {
        requestSocket.connect(currentServerEndpoint);
        console.log('Connected to cluster endpoint ' + currentServerId +
            ' (' + currentServerEndpoint + ')');
    } catch(ex) {
        throw new Error('Failed to connect to cluster endpoint ' +
            currentServerId + ' (' + currentServerEndpoint + ')');
    }
}
