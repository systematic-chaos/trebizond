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

const clientConf = fs.readFileSync(process.argv[2], 'utf-8')
    .split('\t').filter(client => client.length);
const clientId = clientConf[0];
const clientPrivateKey = fs.readFileSync(clientConf[1], 'utf-8');
const servers = fs.readFileSync(process.argv[3], 'utf-8')
    .split('\n').filter(server => server.length);

const serversConfig: Record<number, [string, Buffer]> = {};
servers.forEach((element) => {
    const serverConfig = element.split('\t');
    const serverPublicKey = fs.readFileSync(serverConfig[2]);
    serversConfig[parseInt(serverConfig[0])] = [serverConfig[1], serverPublicKey];
});

function main() {
    const client = new TrebizondClient<RedisOperation, RedisResult>(
        [clientId, clientPrivateKey], serversConfig);
    const variables: Record<string, number> = {};

    setInterval(async () => {
            const nextOperation = generateRedisCommand(variables);
            const opResult = await client.sendCommand(nextOperation);
            console.log(`Value ${opResult.value} was committed to variable ${opResult.key}`);
        }, ((Math.random() * 1000) % 1500) + 1500);
}

function generateRedisCommand(variables: Record<string, number>): RedisOperation {
    const key = Math.round(Math.random()) ? 'A' : 'B';
    const value = Math.floor(Math.random() * 10000);
    const operator = key in variables && Math.floor(Math.random() * 6) > 4 ?
        RedisOperator.assign : RedisOperator.add;

    switch (operator) {
        case RedisOperator.assign:
            variables[key] = value;
            break;
        case RedisOperator.add:
            variables[key] += value;
            break;
    }
    return new RedisOperation(key, operator, value);
}

main();
