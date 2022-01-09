/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 * 
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 * 
 * Javier Fernández-Bravo Peñuela
 * 
 * redis-state-machine/redisCommand.ts
 */

import { Operation,
         Result } from '../trebizond-common/datatypes';
import { StateMachine } from '../state-machine-connector/command';
import { Deferred } from '../trebizond-common/deferred';
import { convertMapToArray,
         convertObjectToArray } from '../trebizond-common/util';
import * as Redis from 'ioredis';

interface RedisCommand {
    key: string;
    operator: RedisOperator;
    value: number;
}

export class RedisOperation extends Operation implements RedisCommand {
    key: string;
    operator: RedisOperator;
    value: number;

    constructor(key: string, operator: RedisOperator, value: number) {
        super();
        this.key = key;
        this.operator = operator;
        this.value = value;
    }
}

export class RedisResult extends Result implements RedisCommand {
    key: string;
    operator: RedisOperator = RedisOperator.assign;
    value: number;

    constructor(key: string, value: number) {
        super();
        this.key = key;
        this.value = value;
    }
}

export enum RedisOperator {
    assign = '=',
    add = '+',
    substract = '-',
    multiply = '*',
    divide = '/'
}

export class RedisStateMachine extends StateMachine<RedisOperation, RedisResult> {

    private redis: Redis.Redis;

    constructor(redis: Redis.Redis) {
        super();
        this.redis = redis;

        this.setArgumentTransformer();
    }

    public async executeOperation(op: RedisOperation): Promise<RedisResult> {
        var p = new Deferred<RedisResult>();
        var newValue: number;
        if (op.operator == RedisOperator.assign) {
            newValue = op.value;
        } else {
            var oldValue = Number(await this.redis.get(op.key));
            switch (op.operator) {
                case RedisOperator.add:
                    newValue = oldValue + op.value;
                    break;
                case RedisOperator.substract:
                    newValue = oldValue - op.value;
                    break;
                case RedisOperator.multiply:
                    newValue = oldValue * op.value;
                    break;
                case RedisOperator.divide:
                    newValue = oldValue / op.value;
                    break;
                default:
                    newValue = op.value;
            }
        }
        this.redis.set(op.key, newValue);
        console.log('Operation committed: ' + op.key + op.operator + op.value);

        this.redis.get(op.key).then((result) => {
            newValue = Number(result);
            console.log(op.key + ' -> ' + newValue);
            p.resolve(new RedisResult(op.key, newValue));
        });
        return p.promise;
    }

    public applyOperation(op: RedisOperation, callback: (result: RedisResult) => any): void {
        this.executeOperation(op).then(callback);
    }
    
    public async getSnapshot(): Promise<Map<string, number>> {
        var p = new Deferred<Map<string, number>>();
        this.redis.hgetall('*', (err: Error, result: any) => {
            if (err !== null && err !== undefined
                && (result === null || result === undefined)) {
                    p.reject(err);
            } else {
                let hash = new Map<string, number>();
                for (let key in result) {
                    hash.set(key, Number(result[key]));
                }
                p.resolve(hash);
            }
        });
        return p.promise;
    }

    public setSnapshot(snapshot: Map<string, number>): void {
        this.redis.hmset('*', snapshot);
    }

    private setArgumentTransformer(): void {
        Redis.Command.setArgumentTransformer('hmset', function(args) {
            if (args.length === 2) {
                if (typeof Map !== 'undefined' && args[1] instanceof Map) {
                    return [args[0]].concat(convertMapToArray(args[1]));
                }
                if (typeof args[1] === 'object' && args[1] !== null) {
                    return [args[0]].concat(convertObjectToArray(args[1]));
                }
            }
            return args;
        });

        Redis.Command.setReplyTransformer('hgetall', function(result) {
            if (Array.isArray(result)) {
                var obj: any = {};
                for (var i = 0; i < result.length; i += 2) {
                    obj[result[i]] = result[i + 1];
                }
                return obj;
            }
            return result;
        });
    }
}
