/* This is adopted from the emscripten */
export async function loadWasm(wasmPath) {
    var Module = {
        print(...args) {
            console.log(...args);
        },
    };

    var out = Module['print'] || console.log.bind(console);
    var err = Module['printErr'] || console.error.bind(console);

    var warnOnce = (text) => {
        warnOnce.shown ||= {};
        if (!warnOnce.shown[text]) {
            warnOnce.shown[text] = 1;
            console.error(text);
        }
    };

    /** @type {!Int8Array} */
    var HEAPU8;
    /** @type {!Uint32Array} */
    var HEAPU32;

    var ptrToString = (ptr) => {
        // With CAN_ADDRESS_2GB or MEMORY64, pointers are already unsigned.
        ptr >>>= 0;
        return '0x' + ptr.toString(16).padStart(8, '0');
    };

    var UTF8Decoder = typeof TextDecoder != 'undefined' ? new TextDecoder() : undefined;

    /**
     * Given a pointer 'idx' to a null-terminated UTF8-encoded string in the given
     * array that contains uint8 values, returns a copy of that string as a
     * Javascript String object.
     * heapOrArray is either a regular array, or a JavaScript typed array view.
     * @param {number=} idx
     * @param {number=} maxBytesToRead
     * @return {string}
     */
    var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead = NaN) => {
        var endIdx = idx + maxBytesToRead;
        var endPtr = idx;
        // TextDecoder needs to know the byte length in advance, it doesn't stop on
        // null terminator by itself.  Also, use the length info to avoid running tiny
        // strings through TextDecoder, since .subarray() allocates garbage.
        // (As a tiny code save trick, compare endPtr against endIdx using a negation,
        // so that undefined/NaN means Infinity)
        while (heapOrArray[endPtr] && !(endPtr >= endIdx)) ++endPtr;

        if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
            return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
        }
        var str = '';
        // If building with TextDecoder, we have already computed the string length
        // above, so test loop end condition against that
        while (idx < endPtr) {
            // For UTF8 byte structure, see:
            // http://en.wikipedia.org/wiki/UTF-8#Description
            // https://www.ietf.org/rfc/rfc2279.txt
            // https://tools.ietf.org/html/rfc3629
            var u0 = heapOrArray[idx++];
            if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
            var u1 = heapOrArray[idx++] & 63;
            if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
            var u2 = heapOrArray[idx++] & 63;
            if ((u0 & 0xF0) == 0xE0) {
                u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
            } else {
                if ((u0 & 0xF8) != 0xF0) warnOnce('Invalid UTF-8 leading byte ' + ptrToString(u0) + ' encountered when deserializing a UTF-8 string in wasm memory to a JS string!');
                u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63);
            }

            if (u0 < 0x10000) {
                str += String.fromCharCode(u0);
            } else {
                var ch = u0 - 0x10000;
                str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
            }
        }
        return str;
    };

    /**
     * Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the
     * emscripten HEAP, returns a copy of that string as a Javascript String object.
     *
     * @param {number} ptr
     * @param {number=} maxBytesToRead - An optional length that specifies the
     *   maximum number of bytes to read. You can omit this parameter to scan the
     *   string until the first 0 byte. If maxBytesToRead is passed, and the string
     *   at [ptr, ptr+maxBytesToReadr[ contains a null byte in the middle, then the
     *   string will cut short at that byte index (i.e. maxBytesToRead will not
     *   produce a string of exact length [ptr, ptr+maxBytesToRead[) N.B. mixing
     *   frequent uses of UTF8ToString() with and without maxBytesToRead may throw
     *   JS JIT optimizations off, so it is worth to consider consistently using one
     * @return {string}
     */
    var UTF8ToString = (ptr, maxBytesToRead) => {
        return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : '';
    };

    var _fd_close = (fd) => {
        console.log('fd_close called without SYSCALLS_REQUIRE_FILESYSTEM');
    };

    var INT53_MAX = 9007199254740992;
    var INT53_MIN = -9007199254740992;
    var bigintToI53Checked = (num) => (num < INT53_MIN || num > INT53_MAX) ? NaN : Number(num);

    function _fd_seek(fd, offset, whence, newOffset) {
        offset = bigintToI53Checked(offset);
        return 70;
    }

    var printCharBuffers = [null,[],[]];

    var printChar = (stream, curr) => {
        var buffer = printCharBuffers[stream];
        if (curr === 0 || curr === 10) {
            (stream === 1 ? out : err)(UTF8ArrayToString(buffer));
            buffer.length = 0;
        } else {
            buffer.push(curr);
        }
    };

    var _fd_write = (fd, iov, iovcnt, pnum) => {
        // hack to support printf in SYSCALLS_REQUIRE_FILESYSTEM=0
        var num = 0;
        for (var i = 0; i < iovcnt; i++) {
            var ptr = HEAPU32[((iov)>>2)];
            var len = HEAPU32[(((iov)+(4))>>2)];
            iov += 8;
            for (var j = 0; j < len; j++) {
                printChar(fd, HEAPU8[ptr+j]);
            }
            num += len;
        }
        HEAPU32[((pnum)>>2)] = num;
        return 0;
    };

    // START
    var wasmImports = {
        _abort_js: () => console.error("not implemented"),
        emscripten_resize_heap: (requestedSize) => console.error("not implemented"),
        environ_get: (__environ, environ_buf) => console.error("not implemented"),
        environ_sizes_get: (penviron_count, penviron_buf_size) => console.error("not implemented"),
        fd_close: _fd_close,
        fd_seek: _fd_seek,
        fd_write: _fd_write
    };
    var response = await (await fetch(wasmPath)).arrayBuffer();
    var binary = new Uint8Array(response);
    var instance = await WebAssembly.instantiate(binary, {
        'env': wasmImports,
        'wasi_snapshot_preview1': wasmImports,
    });
    instance = instance['instance'];
    var b = instance.exports['memory'].buffer;
    HEAPU8 = new Uint8Array(b);
    HEAPU32 = new Uint32Array(b);

    HEAPU32[0] = 1668509029; // from writeStackCookie

    return instance.exports;
}

export function decodeWchar32(memory, ptr) {
    const mem = new Uint32Array(memory.buffer);
    let str = '';
    for (let i = ptr / 4; mem[i] !== 0; i++) {
        if (mem[i] === 0) break;
        str += String.fromCodePoint(mem[i]);
    }
    return str;
}

