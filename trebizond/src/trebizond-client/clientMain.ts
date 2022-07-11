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
import { TrebizondClient } from './trebizondClient';
import * as fs from 'fs';

if (process.argv.length < 4) {
    console.error('usage: nodejs trebizondRedisClient.js <clientFile> <serversFile>');
    process.exit(1);
}

const clientConf = fs.readFileSync(process.argv[2], 'utf-8').split('\t').filter(Boolean);
const clientId = parseInt(clientConf[0]);
const clientPrivateKey = fs.readFileSync(clientConf[1], 'utf-8');
const servers = fs.readFileSync(process.argv[2], 'utf-8').split('\n').filter(Boolean);

const serversConfig = new Map<number, [string, string]>();
servers.forEach((element) => {
    const serverConfig = element.split('\t');
    const serverPublicKey = fs.readFileSync(serverConfig[2], 'utf-8');
    serversConfig.set(parseInt(serverConfig[0]), [serverConfig[1], serverPublicKey]);
});

const client = new TrebizondClient<RedisOperation, RedisResult>([clientId, clientPrivateKey], serversConfig);

let A = 0;
let B = 0;

for (;;) {
    setTimeout(() => {
        const nextOperation = generateRedisCommand();
        client.sendCommand(nextOperation).then((opResult: RedisResult) => {
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
    let key: string;
    let operator: RedisOperator;
    const value = Math.floor(Math.random() * 10000);
    if (Math.round(Math.random())) {
        key = 'A';
        if (A) {
            operator = Math.floor(Math.random() * 6) > 4 ? RedisOperator.assign : RedisOperator.add;
        } else {
            operator = RedisOperator.assign;
        }
        switch (operator) {
            case RedisOperator.assign:
                A = value;
                break;
            case RedisOperator.add:
                A += value;
                break;
        }
    } else {
        key = 'B';
        if (B) {
            operator = Math.floor(Math.random() * 6) > 4 ? RedisOperator.assign : RedisOperator.add;
        } else {
            operator = RedisOperator.assign;
        }
        switch (operator) {
            case RedisOperator.assign:
                B = value;
                break;
            case RedisOperator.add:
                B += value;
                break;
        }
    }
    return new RedisOperation(key, operator, value);
}
