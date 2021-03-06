/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 *
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 *
 * Javier Fernández-Bravo Peñuela
 *
 * trebizond-server/failureDetector.ts
 */

import { Accusation,
         Message,
         Operation,
         OpMessage } from '../trebizond-common/datatypes';
import { ServerNetworkController } from './networkController';
import { checkObjectSignature,
         SignedObject } from '../trebizond-common/crypto';
import { MessageValidator } from '../state-machine-connector/messageValidator';

export class FailureDetector<Op extends Operation> {

    private id: number;
    private peerKeys: Record<number, Buffer>;
    private networkController: ServerNetworkController;
    private validator: MessageValidator<Op>;
    private suspectNodes: Array<number>;

    private onMessageRedirect!: (message: SignedObject<Message>) => void;
    private onRequestRedirect!: (request: SignedObject<OpMessage<Op>>) => void;

    constructor(replicaId: number, peersPublicKeys: Record<number, Buffer>,
            networkController: ServerNetworkController,
            validator: MessageValidator<Op>) {
        this.id = replicaId;
        this.peerKeys = peersPublicKeys;
        this.networkController = networkController;
        this.validator = validator;
        this.suspectNodes = [];

        this.bindMessageInterceptors(networkController);
    }

    private bindMessageInterceptors(networkController: ServerNetworkController): void {
        this.onMessageRedirect = networkController.getOnMessageCallback();
        this.onRequestRedirect = networkController.getOnRequestCallback();
        networkController.setOnMessageCallback(this.onMessage.bind(this));
        networkController.setOnRequestCallback(this.onRequest.bind(this));
    }

    protected authenticationValidation(message: SignedObject<Message>): boolean {
        return message.value.from in this.peerKeys ?
            checkObjectSignature(message, this.peerKeys[message.value.from]) : false;
    }

    protected semanticValidation(message: Message): boolean {
        let validationResult: boolean;
        if (this.instanceOfAccusation(message)) {
            // Recursive function call
            const nestedCheck = this.semanticValidation((message as Accusation<Op>).message.value);
            validationResult = !nestedCheck;
        } else if (this.instanceOfOperationMessage(message)) {
            validationResult = this.validator.semanticValidation((message as OpMessage<Op>).operation.operation);
        } else {
            validationResult = true;
        }
        return validationResult;
    }

    /**
     * A message from other replica is received.
     * In case it is not an operation message, redirect it to the application protocol.
     * In case it is an operation message and it fails authentication validation, discard it.
     * In case it is an operation message and it goes through both
     * authentication and semantic validations, redirect it to the application protocol.
     * In case it is an operation message, it goes through authentication validation
     * and it fails semantic validation, encapsulate it into an accusation message
     * and broadcast accusation to all other replicas.
     */
    public onMessage(msg: SignedObject<Message>): void {

        if (this.instanceOfOperationMessage(msg.value)) {
            if (this.authenticationValidation(msg)) {
                if (this.semanticValidation(msg.value)) {
                    this.onMessageRedirect(msg);
                } else {
                    const accusation: Accusation<Op> = {
                        type: 'Accusation',
                        from: this.id,
                        message: msg as SignedObject<OpMessage<Op>>
                    };
                    this.networkController.sendBroadcast(accusation);
                    if (this.suspectNodes.indexOf(msg.value.from) >= 0) {
                        this.suspectNodes.push(msg.value.from);
                    }
                }
            }
        } else {
            this.onMessageRedirect(msg);
        }
    }

    /**
     * A request from other replica is received
     * In case it goes through authentication and semantic validations,
     * it is redirected to the application protocol.
     * Otherwise, it is discarded.
     */
    public onRequest(request: SignedObject<OpMessage<Op>>): void {
        if (this.validator.semanticValidation(request.value.operation.operation)) {
            this.onRequestRedirect(request);
        }
    }

    private instanceOfAccusation(object: Message): object is Accusation<Op> {
        return object.type === 'Accusation' && !!Object.getOwnPropertyDescriptor(object, 'message');
    }

    private instanceOfOperationMessage(object: Message): object is OpMessage<Op> {
        if (!Object.getOwnPropertyDescriptor(object, 'operation')) {
            return false;
        }

        const outerOp = (object as OpMessage<Op>).operation;
        if (!Object.getOwnPropertyDescriptor(outerOp, 'operation')) {
            return false;
        }

        const innerOp = outerOp.operation;
        return !!innerOp;
    }
}
