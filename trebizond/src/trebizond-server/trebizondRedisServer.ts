/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 *
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 *
 * Javier Fernández-Bravo Peñuela
 *
 * trebizond-server/trebizondRedisServer.ts
 */

import { RedisOperation,
         RedisResult,
         RedisStateMachine } from '../redis-state-machine/redisCommand';
import { RedisMessageValidator } from '../redis-state-machine/redisMessageValidator';
import { TrebizondServer } from '../trebizond-server/server';
import * as fs from 'fs';
import * as IORedis from 'ioredis';

const Redis = IORedis.default;

if (process.argv.length < 8) {
    console.error('usage: nodejs trebizondRedisServer.js <serverId> <exposedEndpoint> <redisEndpoint> <serverPrivateKeyFile> <serversFile> <clientsFile>');
    process.exit(1);
}

const id: number = parseInt(process.argv[2]);
const exposed: string = process.argv[3];
const redisEndpoint: string = process.argv[4];
const privateKey: string = fs.readFileSync(process.argv[5], 'utf-8');
const serversFile: string = process.argv[6];
const peers = fs.readFileSync(serversFile, 'utf-8').split('\n').filter(Boolean);
const clusterSize = peers.length;

const peersTopology = new Map<number, string>();
const peerKeys = new Map<number, string>();
peers.forEach((element) => {
    const peerConfig: string[] = element.split('\t');
    peersTopology.set(Number(peerConfig[0]), peerConfig[1]);
    const peerPublicKey: string = fs.readFileSync(peerConfig[2], 'utf8');
    peerKeys.set(Number(peerConfig[0]), peerPublicKey);
});

const clientsFile: string = process.argv[7];
const clients = fs.readFileSync(clientsFile, 'utf-8').split('\n').filter(Boolean);
const clientKeys = new Map<number, string>();
clients.forEach((element) => {
    const clientConfig: string[] = element.split('\t');
    const clientPublicKey: string = fs.readFileSync(clientConfig[1], 'utf-8');
    clientKeys.set(Number(clientConfig[0]), clientPublicKey);
});

if (id - 1 >= clusterSize || id - 1 < 0) {
    console.error('Server index is out of the input endpoint addresses bounds.');
    process.exit(2);
}

let redisPort: number;
let redisHost: string;
if (redisEndpoint.lastIndexOf(':') > 0) {
    const i = redisEndpoint.lastIndexOf(':');
    redisHost = redisEndpoint.slice(0, i);
    redisPort = Number(redisEndpoint.slice(i + 1));
} else {
    redisHost = redisEndpoint;
    redisPort = 6379;
}

const redis = new Redis(redisPort, redisHost);

new TrebizondServer<RedisOperation, RedisResult>(
    id, peersTopology,
    peerKeys, clientKeys,
    exposed, privateKey, new RedisStateMachine(redis, new RedisMessageValidator()));
