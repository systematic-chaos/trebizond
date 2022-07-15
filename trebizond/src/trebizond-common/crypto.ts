/**
 * Trebizond - Byzantine consensus algorithm for permissioned blockchain systems
 *
 * Byzantine Consensus and Blockchain
 * Master Degree in Parallel and Distributed Computing
 * Polytechnic University of Valencia
 *
 * Javier Fernández-Bravo Peñuela
 *
 * trebizond-common/crypto.ts
 */

import sha2 from 'crypto-js/sha256';
import aes from 'crypto-js/aes';
import utf8 from 'crypto-js/enc-utf8';
import nacl from 'tweetnacl-util';

function generateSignedDigestFromText(text: string, key: string): Uint8Array {
    return encryptText(hashText(text), key);
}

function generateSignedDigestFromBytes(bytes: Uint8Array, key: string): Uint8Array {
    return encryptText(hashBytes(bytes), key);
}

function generateSignedDigestFromObject(obj: object, key: string): Uint8Array {
    return encryptText(hashObject(obj), key);
}

function signText(text: string, key: string): SignedText {
    return {
        value: text,
        signature: generateSignedDigestFromText(text, key)
    };
}

function signBytes(bytes: Uint8Array, key: string): SignedBytes {
    return {
        value: bytes,
        signature: generateSignedDigestFromBytes(bytes, key)
    };
}

function signObject(obj: object, key: string): SignedObject<object> {
    return {
        value: obj,
        signature: generateSignedDigestFromObject(obj, key)
    };
}

function checkTextSignature(signedText: SignedText, key: Buffer): boolean {
    return hashText(signedText.value) ===
        decryptText(signedText.signature, key.toString('utf8'));
}

function checkBytesSignature(signedBytes: SignedBytes, key: Buffer): boolean {
    return hashBytes(signedBytes.value) ===
        decryptText(signedBytes.signature, key.toString('utf8'));
}

function checkObjectSignature(signedObject: SignedObject<object>, key: Buffer): boolean {
    return hashObject(signedObject.value) ===
        decryptText(signedObject.signature, key.toString('utf8'));
}

interface Signed {
    signature: Uint8Array;
}

interface SignedText extends Signed {
    value: string;
}

interface SignedBytes extends Signed {
    value: Uint8Array;
}

interface SignedObject<O extends object> extends Signed {
    value: O;
}

function encryptText(text: string, key: string): Uint8Array {
    return nacl.decodeUTF8(aes.encrypt(text, key).toString());
}

function encryptBytes(bytes: Uint8Array, key: string): Uint8Array {
    return nacl.decodeUTF8(aes.encrypt(nacl.encodeUTF8(bytes), key).toString());
}

function encryptObject(obj: object, key: string): Uint8Array {
    return nacl.decodeUTF8(aes.encrypt(JSON.stringify(obj), key).toString());
}

function decryptText(cipherbytes: Uint8Array, key: string): string {
    return aes.decrypt(nacl.encodeUTF8(cipherbytes), key).toString(utf8);
}

function decryptBytes(cipherbytes: Uint8Array, key: string): Uint8Array {
    return nacl.decodeUTF8(aes.decrypt(nacl.encodeUTF8(cipherbytes), key).toString(utf8));
}

function decryptObject(cipherbytes: Uint8Array, key: string): object {
    return JSON.parse(aes.decrypt(nacl.encodeUTF8(cipherbytes), key).toString(utf8));
}

function hashText(text: string): string {
    return sha2(text).toString();
}

function hashBytes(bytes: Uint8Array): string {
    return sha2(nacl.encodeUTF8(bytes)).toString();
}

function hashObject(obj: object): string {
    return sha2(JSON.stringify(obj)).toString();
}

class Cipher {

    private key: string;

    constructor(privatekey: string) {
        this.key = privatekey;
    }

    public generateSignedDigestFromText(text: string): Uint8Array {
        return generateSignedDigestFromText(text, this.key);
    }

    public generateSignedDigestFromBytes(bytes: Uint8Array): Uint8Array {
        return generateSignedDigestFromBytes(bytes, this.key);
    }

    public generateSignedDigestFromObject(obj: object): Uint8Array {
        return generateSignedDigestFromObject(obj, this.key);
    }

    public signText(text: string): SignedText {
        return signText(text, this.key);
    }

    public signBytes(bytes: Uint8Array): SignedBytes {
        return signBytes(bytes, this.key);
    }

    public signObject(obj: object): SignedObject<object> {
        return signObject(obj, this.key);
    }

    public decryptText(cipherbytes: Uint8Array): string {
        return decryptText(cipherbytes, this.key);
    }

    public decryptBytes(cipherbytes: Uint8Array): Uint8Array {
        return decryptBytes(cipherbytes, this.key);
    }

    public decryptObject(cipherbytes: Uint8Array): object {
        return decryptObject(cipherbytes, this.key);
    }
}

export {
    generateSignedDigestFromText, generateSignedDigestFromBytes, generateSignedDigestFromObject,
    signText, signBytes, signObject,
    checkTextSignature, checkBytesSignature, checkObjectSignature,
    SignedText, SignedBytes, SignedObject,
    encryptText, encryptBytes, encryptObject,
    decryptText, decryptBytes, decryptObject,
    hashText, hashBytes, hashObject,
    Cipher };
