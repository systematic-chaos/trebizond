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

import Redis from 'ioredis';
import { readFileSync } from 'fs';
import { RedisOperation,
         RedisResult,
         RedisStateMachine } from '../redis-state-machine/redisCommand';
import { RedisMessageValidator } from '../redis-state-machine/redisMessageValidator';
import { TrebizondServer, PeerDefinition } from '../trebizond-server/server';
import { log } from '../trebizond-common/logger';
import { sleep } from '../trebizond-common/util';


if (process.argv.length < 8) {
    log.error('usage: nodejs trebizondRedisServer.js <serverId> <exposedEndpoint> <redisEndpoint> <serverPrivateKeyFile> <serversFile> <clientsFile>');
    process.exit(1);
}

const id = parseInt(process.argv[2]);
const exposedEndpoint = process.argv[3];
const redisEndpoint = process.argv[4];
const privateKey = readFileSync(process.argv[5], 'utf8');
const serversFile = process.argv[6];
const clientsFile = process.argv[7];

const peers: Record<number, PeerDefinition> = {};
readFileSync(serversFile, 'utf8').split('\n').filter(server => server.length > 0)
    .forEach((server) => {
        const serverDef = server.split('\t');
        const id = parseInt(serverDef[0]);
        const endpoint = serverDef[1];
        const publicKey = readFileSync(serverDef[2]);
        peers[id] = { id, endpoint, publicKey };
    });
const clusterSize = Object.keys(peers).length;

const clients: Record<string, Buffer> = {};
readFileSync(clientsFile, 'utf8').split('\n').filter(client => client.length > 0)
    .forEach((client) => {
        const [id, publicKeyFile] = client.split('\t');
        clients[id] = readFileSync(publicKeyFile);
    });

if (id - 1 >= clusterSize || id - 1 < 0) {
    log.error('Server index is out of the input endpoint addresses bounds.');
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

async function main() {
    await sleep(3000);
    const redis = new Redis(redisPort, redisHost);
    log.info(redis.status);

    const server = new TrebizondServer<RedisOperation, RedisResult>(
        id, peers, clients, exposedEndpoint, privateKey,
        new RedisStateMachine(redis, new RedisMessageValidator()));
    server.launch();

    redis.disconnect(false);
}

main();
