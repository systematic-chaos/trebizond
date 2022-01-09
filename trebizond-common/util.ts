/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 * 
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 * 
 * Javier Fernández-Bravo Peñuela
 * 
 * trebizond-common/util.ts
 */

export function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export async function sleep(ms: number) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

// Implemented to replace analogous functions provided by an internal module from ioRedis

export function convertMapToArray<K, V>(map: Map<K, V>): Array<K|V> {
    var array: Array<K|V> = [];
    for (var entry of map.entries()) {
        array.push(entry[0], entry[1]);
    }
    return array;
}

export function convertObjectToArray(object: any): Array<any> {
    var array: Array<any> = [];
    for (var key in object) {
        array.push(key, object[key]);
    }
    return array;
}
