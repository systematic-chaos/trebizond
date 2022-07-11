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
import { RedisMessageValidator } from './redisMessageValidator';
import { Deferred as QPromise } from '../trebizond-common/deferred';
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

    public isReadOperation(): boolean {
        return this.operator === RedisOperator.check;
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
    divide = '/',
    check = '<-'
}

export class RedisStateMachine extends StateMachine<RedisOperation, RedisResult> {

    private redis: Redis.Redis;

    constructor(redis: Redis.Redis, msgValidator: RedisMessageValidator) {
        super(msgValidator);
        this.redis = redis;

        this.setArgumentTransformer();
    }

    public async executeOperation(op: RedisOperation): Promise<RedisResult> {
        const p = new QPromise<RedisResult>();
        let newValue: number;
        if (op.operator === RedisOperator.assign) {
            newValue = op.value;
        } else {
            const oldValue = Number(await this.redis.get(op.key));
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
        if (RedisOperator.check !== op.operator) {
            this.redis.set(op.key, newValue);
            console.log('Operation committed: ' + op.key + op.operator + op.value);
        }

        this.redis.get(op.key).then((result) => {
            newValue = Number(result);
            console.log(op.key + ' -> ' + newValue);
            p.resolve(new RedisResult(op.key, newValue));
        });
        return p.promise;
    }

    public applyOperation(op: RedisOperation, callback: (result: RedisResult) => void): void {
        this.executeOperation(op).then(callback);
    }

    public async getSnapshot(): Promise<Map<string, number>> {
        const p = new QPromise<Map<string, number>>();
        this.redis.hgetall('*', (err: Error|null, result: Record<string, string>) => {
            if (err !== null && err !== undefined
                && (result === null || result === undefined)) {
                    p.reject(err);
            } else {
                const hash = new Map<string, number>();
                for (const key in result) {
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
                const [key, values] = args;
                return [key].concat(Array.isArray(values) ? values.flat() : values);
            }
            return args;
        });

        Redis.Command.setReplyTransformer('hgetall', function(result: string[]) {
            if (Array.isArray(result)) {
                const obj: Record<string, string> = {};
                for (let i = 0; i < result.length; i+=2) {
                    obj[result[i]] = result[i + 1];
                }
                return obj;
            }
            return result;
        });
    }
}
