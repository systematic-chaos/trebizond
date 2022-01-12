/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 * 
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 * 
 * Javier Fernández-Bravo Peñuela
 * 
 * trebizond-client/clientMain.ts
 */

import { RedisOperation,
         RedisOperator,
         RedisResult } from '../redis-state-machine/redisCommand';
import { Result } from '../trebizond-common/datatypes';
import { TrebizondClient } from './trebizondClient';
import * as fs from 'fs';

if (process.argv.length != 4) {
    console.error('usage: nodejs trebizondRedisClient.js <clientFile> <serversFile>');
    process.exit(1);
}

let clientConf : string[] = fs.readFileSync(process.argv[2], 'utf-8').split('\t').filter(Boolean);
let clientId: number = Number(clientConf[0]);
let clientEndpoint: string = clientConf[1];
let clientPrivateKey: string = clientConf[2];
clientPrivateKey = fs.readFileSync(clientPrivateKey, 'utf-8');

let serversFile: string = process.argv[2];
let servers = fs.readFileSync(serversFile, 'utf-8').split('\n').filter(Boolean);
var serversConfig = new Map<number, [string, string]>();
servers.forEach((element) => {
    let serverConfig: string[] = element.split('\t');
    let serverPublicKey: string = fs.readFileSync(serverConfig[2], 'utf-8');
    serversConfig.set(Number(serverConfig[0]), [serverConfig[1], serverPublicKey]);
});

var client = new TrebizondClient([clientId, clientEndpoint, clientPrivateKey], serversConfig);

var A: number = 0;
var B: number = 0;

while (true) {
    var nextOperation: RedisOperation;
    setTimeout(() => {
        nextOperation = generateRedisCommand();
        client.sendCommand(nextOperation).then((value: Result) => {
            let opResult = value as RedisResult;
            switch (opResult.key) {
                case 'A':
                    A = opResult.value;
                    break;
                case 'B':
                    B = opResult.value;
                    break;
            }
        });
    }, ((Math.random() * 1000) % 1500) + 1500);
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
