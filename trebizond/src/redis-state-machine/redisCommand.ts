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

import Redis from 'ioredis';
import { Operation } from '../trebizond-common/datatypes';
import { StateMachine } from '../state-machine-connector/command';
import { RedisMessageValidator } from './redisMessageValidator';
import { log } from '../trebizond-common/logger';

interface RedisCommand {
    key: string;
    operator: RedisOperator;
    value: number;
}

class RedisOperation implements Operation, RedisCommand {
    key: string;
    operator: RedisOperator;
    value: number;

    constructor(key: string, operator: RedisOperator, value: number) {
        this.key = key;
        this.operator = operator;
        this.value = value;
    }

    public isReadOperation(): boolean {
        return this.operator === RedisOperator.check;
    }
}

class RedisResult implements RedisCommand {
    key: string;
    operator: RedisOperator = RedisOperator.assign;
    value: number;

    constructor(key: string, value: number) {
        this.key = key;
        this.value = value;
    }
}

enum RedisOperator {
    assign = '=',
    add = '+',
    substract = '-',
    multiply = '*',
    divide = '/',
    check = '<-'
}

class RedisStateMachine extends StateMachine<RedisOperation, RedisResult> {

    private redis: Redis.Redis;

    constructor(redis: Redis.Redis, msgValidator: RedisMessageValidator) {
        super(msgValidator);
        this.redis = redis;

        this.setArgumentTransformer();
    }

    public async executeOperation(op: RedisOperation): Promise<RedisResult> {
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
            log.info(`Operation committed: ${op.key} ${op.operator} ${op.value}`);
        }

        newValue = Number(await this.redis.get(op.key));
        log.info(`${op.key} -> ${newValue}`);
        return new RedisResult(op.key, newValue);
    }

    public applyOperation(op: RedisOperation, callback: (result: RedisResult) => void): void {
        this.executeOperation(op).then(callback);
    }

    public getSnapshot(): Promise<Record<string, number>> {
        return new Promise<Record<string, number>>((resolve, reject) => {
            this.redis.hgetall('*', (err, result) => {
                if (result && !err) {
                    resolve(Object.fromEntries(Object.entries(result).map(
                        ([k, v]) => [k, Number(v)])));
                } else {
                    reject(err);
                }
            });
        });
    }

    public setSnapshot(snapshot: Record<string, number>): Promise<void> {
        return new Promise<void>(resolve => this.redis.hmset('*', snapshot, () => resolve()));
    }

    private setArgumentTransformer(): void {
        Redis.Command.setArgumentTransformer('hmset', function(args) {
            if (args.length === 2) {
                const [key, values] = args;
                return [key].concat(Array.isArray(values) ? values.flat() : values);
            }
            return args;
        });

        Redis.Command.setReplyTransformer('hgetall', function(result) {
            if (Array.isArray(result)) {
                const obj: Record<string, string> = {};
                for (let i = 0; i < result.length; i+=2) {
                    obj[result[i]] = result[i + 1];
                }
                return obj;
            } else {
                return result;
            }
        });
    }
}

export { RedisCommand, RedisOperator, RedisOperation, RedisResult, RedisStateMachine };
