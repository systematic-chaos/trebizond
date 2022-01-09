/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 * 
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 * 
 * Javier Fernández-Bravo Peñuela
 * 
 * trebizond-server/trebizondMainServer.ts
 */

import { TrebizondOperation } from '../trebizond-common/datatypes';
import { RedisOperation,
         RedisStateMachine } from '../redis-state-machine/redisCommand';
import * as fs from 'fs';
import * as Redis from 'ioredis';

if (process.argv.length != 6) {
    console.error('usage: nodejs trebizondRedisServer.js <exposedEndpoint> <redisEndpoint> <serverId> <serversFile>');
    process.exit(1);
}

let exposed: string = process.argv[2];
let redisEndpoint: string = process.argv[3];
let id: number = parseInt(process.argv[4]);
let serversFile: string = process.argv[5];
let peers: string[] = fs.readFileSync(serversFile, 'utf-8').split('\n').filter(Boolean);
let clusterSize = peers.length;
var peersTopology = new Map<number, string>();
for (let n = 0; n < clusterSize; n++) {
    peersTopology.set(n + 1, peers[n]);
}
if (id - 1 >= clusterSize || id - 1 < 0) {
    console.error('Server index is out of the input endpoint addresses bounds.');
    process.exit(2);
}

let redisPort: number;
let redisHost: string;
if (redisEndpoint.lastIndexOf(':') > 0) {
    let i = redisEndpoint.lastIndexOf(':');
    redisHost = redisEndpoint.slice(0, i);
    redisPort = Number(redisEndpoint.slice(i + 1));
} else {
    redisHost = redisEndpoint;
    redisPort = 6379;
}

var redis = Redis(redisPort, redisHost);

/*var server = new Server<TrebizondOperation<RedisOperation>>(
    id, peersTopology, exposed, new RedisStateMachine(redis));*/
