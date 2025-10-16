/**********************************************************\
|                                                          |
| xxtea.gs                                                 |
|                                                          |
| XXTEA encryption algorithm library for Google Apps Script.|
| Adapted to use built-in Google Utilities for Base64      |
| and UTF-8 handling.                                      |
|                                                          |
\**********************************************************/
'use strict';
/**
 * Encrypts data with a key using XXTEA and returns a Base64 string.
 *\n * @param {string} data The data to encrypt (e.g., a cell reference).
 * @param {string} key The secret encryption key.
 * @return {string} The Base64 encoded encrypted data.
 * @customfunction
 */
function XXTEA_ENCRYPT(data, key) {
  if (data === undefined || data === null || data === '') return '';
  if (key === undefined || key === null || key === '') return 'ERROR: Key is required.';
  
  try {
    return encryptToBase64(String(data), String(key));
  } catch (e) {
    return 'ERROR: ' + e.message;
  }
}

/**
 * Decrypts Base64 encoded data with a key using XXTEA.
 *\n * @param {string} data The Base64 data to decrypt (e.g., a cell reference).
 * @param {string} key The secret decryption key.
 * @return {string} The decrypted data, or an empty string if decryption fails.
 * @customfunction
 */
function XXTEA_DECRYPT(data, key) {
  if (data === undefined || data === null || data === '') return '';
  if (key === undefined || key === null || key === '') return 'ERROR: Key is required.';

  try {
    var decrypted = decryptFromBase64(String(data), String(key));
    // If decryption fails (e.g., wrong key), the result is null.
    return decrypted === null ? '' : decrypted;
  } catch (e) {
    // This catches errors from invalid Base64, etc.
    return '';
  }
}

//================================================================//
// XXTEA Core Implementation (Adapted for Google Apps Script)
//================================================================//

var DELTA = 0x9E3779B9;

/**
 * Converts a byte array to a Uint32Array.
 * @param {byte[]} bytes The byte array.
 * @param {boolean} includeLength Whether to include the original length.
 * @return {number[]} The Uint32Array.
 */
function toUint32Array(bytes, includeLength) {
    var length = bytes.length;
    var n = length >> 2;
    if ((length & 3) !== 0) {
        ++n;
    }
    var v = [];
    for (var i = 0; i < n; i++) {
        v[i] = 0;
    }
    if (includeLength) {
        v[n] = length;
    }

    for (var i = 0; i < length; ++i) {
        v[i >> 2] |= (bytes[i] & 0xFF) << ((i & 3) << 3);
    }
    return v;
}

/**
 * Converts a Uint32Array to a byte array.
 * @param {number[]} v The Uint32Array.
 * @param {boolean} includeLength Whether the array includes the original length.
 * @return {byte[]|null} The byte array or null on failure.
 */
function toByteArray(v, includeLength) {
    var length = v.length;
    var n = length << 2;
    if (includeLength) {
        var m = v[length - 1];
        n -= 4;
        if ((m < n - 3) || (m > n)) {
            return null; // Integrity check failed
        }
        n = m;
    }
    var bytes = [];
    for (var i = 0; i < n; ++i) {
        bytes.push((v[i >> 2] >>> ((i & 3) << 3)) & 0xFF);
    }
    return bytes;
}

function int32(i) {
    return i & 0xFFFFFFFF;
}

function mx(sum, y, z, p, e, k) {
    return ((z >>> 5 ^ y << 2) + (y >>> 3 ^ z << 4)) ^ ((sum ^ y) + (k[p & 3 ^ e] ^ z));
}

function fixk(k) {
    // The key array `k` must have at least 4 elements (128 bits).
    // If it's shorter, it's padded with zeros to ensure consistent behavior.
    while (k.length < 4) {
        k.push(0);
    }
    return k;
}

function encryptUint32Array(v, k) {
    var length = v.length;
    var n = length - 1;
    var y, z, sum, e, p, q;
    z = v[n];
    sum = 0;
    for (q = Math.floor(6 + 52 / length) | 0; q > 0; --q) {
        sum = int32(sum + DELTA);
        e = sum >>> 2 & 3;
        for (p = 0; p < n; ++p) {
            y = v[p + 1];
            z = v[p] = int32(v[p] + mx(sum, y, z, p, e, k));
        }
        y = v[0];
        z = v[n] = int32(v[n] + mx(sum, y, z, n, e, k));
    }
    return v;
}

function decryptUint32Array(v, k) {
    var length = v.length;
    var n = length - 1;
    var y, z, sum, e, p, q;
    y = v[0];
    q = Math.floor(6 + 52 / length);
    for (sum = int32(q * DELTA); sum !== 0; sum = int32(sum - DELTA)) {
        e = sum >>> 2 & 3;
        for (p = n; p > 0; --p) {
            z = v[p - 1];
            y = v[p] = int32(v[p] - mx(sum, y, z, p, e, k));
        }
        z = v[n];
        y = v[0] = int32(v[0] - mx(sum, y, z, 0, e, k));
    }
    return v;
}

function encryptToBase64(data, key) {
    var dataBytes = Utilities.newBlob(data).getBytes();
    var keyBytes = Utilities.newBlob(key).getBytes();

    var v = toUint32Array(dataBytes, true);
    var k = toUint32Array(keyBytes, false);
    
    var encryptedV = encryptUint32Array(v, fixk(k));
    var encryptedBytes = toByteArray(encryptedV, false);

    return Utilities.base64Encode(encryptedBytes);
}

function decryptFromBase64(data, key) {
    var dataBytes = Utilities.base64Decode(data);
    var keyBytes = Utilities.newBlob(key).getBytes();

    var v = toUint32Array(dataBytes, false);
    var k = toUint32Array(keyBytes, false);

    var decryptedV = decryptUint32Array(v, fixk(k));
    var decryptedBytes = toByteArray(decryptedV, true);

    if (decryptedBytes === null) {
        return null; // Decryption failed
    }

    return Utilities.newBlob(decryptedBytes).getDataAsString();
}
