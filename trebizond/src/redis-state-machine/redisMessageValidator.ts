/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 * 
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 * 
 * Javier Fernández-Bravo Peñuela
 * 
 * redis-state-machine/redisMessageValidator.ts
 */

import { RedisOperator,
         RedisOperation } from './redisCommand';
import { MessageValidator } from '../state-machine-connector/messageValidator';

export class RedisMessageValidator extends MessageValidator<RedisOperation> {

    public semanticValidation(op: RedisOperation): boolean {
        var validKey = op.key === 'A' || op.key === 'B';
        var validOperator = op.operator === RedisOperator.add || op.operator === RedisOperator.assign;
        var validValue = op.value >= 0;
        return validKey && validOperator && validValue;
    }
}
