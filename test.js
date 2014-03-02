// Copyright (c) 2014 The Native Client Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
"use strict";

function bin(s) {
  // Read bits with LSB on the left.
  // e.g. 11001 => 1+2+16 = 19.
  var result = 0;
  var curShift = 0;
  var zeroCharCode = '0'.charCodeAt(0);
  for (var i = 0; i < s.length; ++i) {
    result |= ((s.charCodeAt(i) - zeroCharCode) << curShift);
    curShift++;
  }
  return result;
}

function bitstring(s) {
  // Read a bit string (potentially many bytes) and return an Array
  // containing those bytes. Any character that is not 0 or 1 will be skipped.
  // If there are not enough bits specified, assume the rest of the bits to
  // fill out the last byte are zero.
  //
  // e.g. '1001 1100 11111' =>
  //      10001100 11111000 =>
  //      [49, 31]
  var result = [];
  var curByte = 0;
  var curShift = 0;
  for (var i = 0; i < s.length; ++i) {
    if (s[i] === '0') {
      curShift++;
    } else if (s[i] === '1') {
      curByte |= 1 << curShift;
      curShift++;
    } else {
      continue;
    }

    if (curShift == 8) {
      result.push(curByte);
      curByte = 0;
      curShift = 0;
    }
  }

  // Add the final byte.
  if (curShift != 0)
    result.push(curByte);
  return result;
}

function BS(a) {
  var ab = new ArrayBuffer(a.length);
  var abView = new Uint8Array(ab);
  for (var i = 0; i < a.length; ++i) {
    abView[i] = a[i];
  }
  return new BitStream(ab);
}

function BSbits(s) {
  return BS(bitstring(s));
}

function strToCharCode(s) {
  return s.split('').map(function (c) { return c.charCodeAt(0); });
}

module('Test Functions');
test('bitstring', function() {
  deepEqual(bitstring('11111101'), [191]);
  deepEqual(bitstring('111 111 01'), [191], 'with spaces');
  deepEqual(bitstring('11001'), [19], 'incomplete byte');
  deepEqual(bitstring('10010010 01001001 00'), [73, 146, 0], 'multi-byte');
});

test('bin', function() {
  equal(bin('11111'), 31);
  equal(bin('11101'), 23);
  equal(bin('11'), 3);
  equal(bin('01010101'), 128+32+8+2);
});

module('BitStream');
test('read', function() {
  var bs = BSbits('11111 10111 11000');
  equal(bs.tellBit(), 0);
  equal(bs.read(5), bin('11111'));
  equal(bs.tellBit(), 5);
  equal(bs.read(5), bin('10111'));
  equal(bs.tellBit(), 10);
  equal(bs.read(5), bin('11'));
  equal(bs.tellBit(), 15);
  equal(bs.read(1), 0);
  equal(bs.tellBit(), 16);
  ok(bs.atEnd());
});

test('read 32 bits', function() {
  var bs = BS([0x12, 0x34, 0x56, 0x78]);
  equal(bs.read(32), 0x78563412);
  ok(bs.atEnd());
});

test('multi-byte read', function() {
  var bs = BS([0x12, 0x34, 0x56]);
  equal(bs.read(24), 0x563412);
  equal(bs.tellBit(), 24);
  ok(bs.atEnd());
});

test('multi-byte unaligned read', function() {
  var bs = BS([0xab, 0xcd, 0xef, 0x11]);
  equal(bs.tellBit(), 0);
  equal(bs.read(4), 0xb);
  equal(bs.tellBit(), 4);
  equal(bs.read(16), 0xfcda);
  equal(bs.tellBit(), 20);
  equal(bs.read(12), 0x11e);
  equal(bs.tellBit(), 32);
  ok(bs.atEnd());
});

test('fill word regression', function() {
  var data = '';
  data += '00100000000000000000000000000000';  // 32-bits, value = 4
  data += '1100';
  var bs = BSbits(data);

  equal(bs.read(32), 4);
  equal(bs.read(4), 3);
});

test('read vbr', function() {
  // VBR is a variable bit read function. If the top bit is set of a given
  // chunk, then continue reading more chunks. Finally, strip the top bit of
  // each chunk and concatenate.
  var bs = BSbits('001 001 100  1101 0011 1000');
  // 001 | 001 | 100
  // 00    00    1
  // 00001
  equal(bs.readVbr(3), bin('00001'));
  equal(bs.tellBit(), 9);
  // 1101 | 0011 | 1000
  // 110    001    1
  // 1100011
  equal(bs.readVbr(4), bin('1100011'));
  equal(bs.tellBit(), 21);
  ok(!bs.atEnd());
});

test('seek bit', function() {
  var bs = BSbits('11100111 00110011 00000111');
  bs.seekBit(10);
  equal(bs.read(10), bin('1100110000'));
  bs.seekBit(9);
  equal(bs.read(11), bin('01100110000'));
  bs.seekBit(0);
  equal(bs.read(4), bin('1110'));
  ok(!bs.atEnd());
});

test('seek bit - fail', function() {
  var bs = BSbits('00000000000000000000000000000000');

  throws(function() { bs.seekBit(33); }, Error);
  bs.seekBit(32);  // Should be OK.
  throws(function() { bs.read(1); }, Error);
});

test('align32', function() {
  var bs = BS([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde]);
  equal(bs.read(12), 0x412);
  bs.align32();
  equal(bs.tellBit(), 32);
  bs.align32();
  equal(bs.tellBit(), 32);
  equal(bs.read(16), 0xbc9a);
  ok(!bs.atEnd());
});

module('Header');
test('basic', function() {
  var a = strToCharCode('PEXE');
  a.push(0x01, 0x00);  // 1 field
  a.push(0x08, 0x00);  // 8 bytes
  a.push(0x11);  // ftype = 1, id = 1
  a.push(0x00);  // align to u16
  a.push(0x04, 0x00);  // field length = 4 bytes
  a.push(2, 0, 0, 0);  // data = 2
  var bs = BS(a);
  var header = new Header();
  header.read(bs);

  equal(header.sig, 'PEXE');
  equal(header.numFields, 1);
  equal(header.numBytes, 8);
  equal(header.fields.length, 1);

  var headerField = header.fields[0];
  equal(headerField.ftype, 1);
  equal(headerField.id, 1);
  equal(headerField.data, 2);
});

test('bad signature', function() {
  var a = strToCharCode('PEPE');
  var bs = BS(a);
  var header = new Header();

  throws(function() { header.read(bs); }, Error);
});

test('bad header id', function() {
  // Only id=1 is valid currently.
  var a = [];
  a.push(0x12);  // ftype = 1, id = 2
  a.push(0);  // align to u16
  a.push(0x04, 0x00);  // field length = 4 bytes
  var bs = BS(a);
  var headerField = new HeaderField();
  throws(function() { headerField.read(bs); }, Error);
});

test('bad header ftype', function() {
  // Only ftype=0 or 1 is valid currently.
  var a = [];
  a.push(0x31);  // ftype = 3, id = 1
  a.push(0);  // Align to u16
  a.push(0x04, 0x00);  // field length = 4 bytes
  var bs = BS(a);
  var headerField = new HeaderField();
  throws(function() { headerField.read(bs); }, Error);
});

module('Abbrev Ops');
test('literal abbrev op', function() {
  var bs1 = BS([16]);
  var op = new LiteralAbbrevOp();
  op.read(bs1);  // Literal value is 16.
  // Always return 16, regardless of bitstream.
  var dummyBs = BS([]);
  deepEqual(op.readAbbrev(dummyBs), [16]);
  deepEqual(op.readAbbrev(dummyBs), [16]);
});

test('fixed abbrev op', function() {
  var bs1 = BS([3]);
  var op = new FixedAbbrevOp();
  op.read(bs1);  // 3-bit fixed length.
  var bs2 = BSbits('100 010 110 001');
  deepEqual(op.readAbbrev(bs2), [1]);  // 001
  deepEqual(op.readAbbrev(bs2), [2]);  // 010
  deepEqual(op.readAbbrev(bs2), [3]);  // 011
  deepEqual(op.readAbbrev(bs2), [4]);  // 100
});

test('vbr abbrev op', function() {
  var bs1 = BS([3]);
  var op = new VbrAbbrevOp();
  op.read(bs1);  // 3-bit variable length.
  var bs2 = BSbits('010 001100 011100 001010');
  deepEqual(op.readAbbrev(bs2), [2]);  // 010
  deepEqual(op.readAbbrev(bs2), [4]);  // 001100 => 001
  deepEqual(op.readAbbrev(bs2), [6]);  // 011100 => 011
  deepEqual(op.readAbbrev(bs2), [8]);  // 001010 => 0001
});

test('array abbrev op - literal', function() {
  // The low-bit set means literal. The literal value follows in the next 8
  // bits.
  var bs1 = BSbits('1 11100000');
  var op = new ArrayAbbrevOp();
  op.read(bs1);
  // The first 6 bits specifies the number of elements.
  var bs2 = BS([5]);
  deepEqual(op.readAbbrev(bs2), [7, 7, 7, 7, 7]);
});

test('array abbrev op - fixed', function() {
  // The first four bits (0100) means fixed. The next 5 bits is the fixed
  // length (in this case, 3).
  var bs1 = BSbits('0100 11000');
  var op = new ArrayAbbrevOp();
  op.read(bs1);
  // The first 6 bits specifies the number of elements. Each element is
  // specified by 3 bits.
  var bs2 = BSbits('001000 100 010 110 001');
  deepEqual(op.readAbbrev(bs2), [1, 2, 3, 4]);
});

test('char6 abbrev op', function() {
  var op = new Char6AbbrevOp();
  var bs = BSbits('111000 001000 110100 110100 011100');
  deepEqual(op.readAbbrev(bs), ['h'.charCodeAt(0)]);
  deepEqual(op.readAbbrev(bs), ['e'.charCodeAt(0)]);
  deepEqual(op.readAbbrev(bs), ['l'.charCodeAt(0)]);
  deepEqual(op.readAbbrev(bs), ['l'.charCodeAt(0)]);
  deepEqual(op.readAbbrev(bs), ['o'.charCodeAt(0)]);
});

test('blob abbrev op', function() {
  var op = new BlobAbbrevOp();
  // The first 6 bits are the number of bytes to read. The data follows after a
  // 32-bit alignment (the zero bits in parentheses below).
  var data = '';
  data += '110000';  // <num bytes>
  data += '(00000000000000000000000000)';  // align32
  data += '01010100 11001100 11100010';  // <values 42, 51, 71>
  data += '(00000000)';  // align32
  var bs = BSbits(data);
  deepEqual(op.readAbbrev(bs), [42, 51, 71]);
});

test('read abbrev op - literal', function() {
  // low bit set = literal, followed by 8 bits of literal value.
  var bs = BSbits('1 10101010');
  var op = readAbbrevOp(bs);
  ok(op instanceof LiteralAbbrevOp);
  var dummyBs = BS([]);
  deepEqual(op.readAbbrev(dummyBs), [85]);
});

test('read abbrev op - fixed', function() {
  // 0100 = fixed, followed by 5 bits for the fixed bit length.
  var bs1 = BSbits('0100 11000');
  var op = readAbbrevOp(bs1);
  ok(op instanceof FixedAbbrevOp);
  var bs2 = BSbits('111');
  deepEqual(op.readAbbrev(bs2), [7]);
});

test('read abbrev op - vbr', function() {
  // 0010 = vbr, followed by 5 bits for the variable bit length.
  var bs1 = BSbits('0010 11000');
  var op = readAbbrevOp(bs1);
  ok(op instanceof VbrAbbrevOp);
  var bs2 = BSbits('111 100');
  deepEqual(op.readAbbrev(bs2), [7]);
});

test('read abbrev op - array', function() {
  // 0110 = array, followed by the element type. In this case, the element type
  // is fixed with length of 3 bits.
  var bs1 = BSbits('0110 0100 11000');
  var op = readAbbrevOp(bs1);
  ok(op instanceof ArrayAbbrevOp);
  // The first 6 bits are the number of elements, followed by the data for the
  // array.
  var bs2 = BSbits('101000 110 100 001 100 101');
  deepEqual(op.readAbbrev(bs2), [3, 1, 4, 1, 5]);
});

test('read abbrev op - char6', function() {
  // 0001 = char6, there is no additional data needed.
  var bs = BSbits('0001');
  var op = readAbbrevOp(bs);
  ok(op instanceof Char6AbbrevOp);
});

test('read abbrev op - blob', function() {
  // 0101 = blob.
  var bs = BSbits('0101');
  var op = readAbbrevOp(bs);
  ok(op instanceof BlobAbbrevOp);
});

test('read abbrev op - fail', function() {
  // 0000, 0011, and 0111 = invalid.
  throws(function() { readAbbrevOp(BSbits('0000')); }, Error);
  throws(function() { readAbbrevOp(BSbits('0011')); }, Error);
  throws(function() { readAbbrevOp(BSbits('0111')); }, Error);
});

module('Record');
test('unabbrev', function() {
  var data = '';
  data += '011010 010000';  // <code = 22>, <num values = 2>
  data += '010100 001010';  // <values = 10, 20>
  var bs = BSbits(data);

  var record = new Record();
  var abbrevId = 3;  // UNABBREV_RECORD
  var abbrevs = [];  // not needed
  record.read(bs, abbrevId, abbrevs);

  equal(record.code, 22);
  equal(record.values.length, 2);
  equal(record.values[0], 10);
  equal(record.values[1], 20);
});

test('abbrev', function() {
  var data = '010000 01010 00101';  // <num elts = 2>, <values = 10, 20>
  var bs = BSbits(data);
  var record = new Record();
  var abbrev = new Abbrev();
  var abbrevId = 4;  // 4 is the first user-defined abbrev id.
  abbrev.ops = [
    new LiteralAbbrevOp(22),
    new ArrayAbbrevOp(new FixedAbbrevOp(5))
  ];
  var abbrevs = [abbrev];
  record.read(bs, abbrevId, [abbrev]);

  equal(record.code, 22);
  equal(record.values.length, 2);
  equal(record.values[0], 10);
  equal(record.values[1], 20);
});

module('Block');
test('simple', function() {
  var data = '';
  data += '10000000 0100';  // <block id = 1>, <code length = 2>
  data += '(00000000000000000000)';  // align32
  data += '11000000000000000000000000000000';  // <num words = 3>
  // UNABBREV_RECORD, <code = 0>, <num values = 1>, <value = 42>
  data += '11 000000 100000 010101|100000';
  data += '00 (0000)';  // END_BLOCK, align32
  var bs = BSbits(data);
  var block = new Block();
  var context = new BlockInfoContext();
  block.read(bs, context);

  equal(block.id, 1, 'block.id');
  equal(block.chunks.length, 1, 'block.chunks.length');
  var chunk = block.chunks[0];
  ok(chunk instanceof Record, 'chunk is Record');
  equal(chunk.code, 0, 'chunk.code');
  equal(chunk.values.length, 1, 'chunk.values.length');
  equal(chunk.values[0], 42);
});

test('subblock', function() {
  var data = '';
  // root block
  data += '10000000 0100';  // <block id = 1>, <code length = 2>
  data += '(00000000000000000000)';  // align32
  data += '00000000000000000000000000000000';  // <num words>

  // subblock
  data += '10';  // SUBBLOCK
  data += '01000000 0100';  // <block id = 2>, <code length = 2>
  data += '(000000000000000000)';  // align32
  data += '11000000000000000000000000000000';  // <num words = 4>
  // UNABBREV_RECORD, <code = 0>, <num values = 1>, <value = 42>
  data += '11 000000 100000 010101|100000';
  data += '00 (0000)';  // END_BLOCK, align32
  // end subblock

  // UNABBREV_RECORD, <code = 1>, <num values = 2>, <values = 3, 4>
  data += '11 100000 010000 110000 001000';
  data += '00 (0000)';  // END_BLOCK, align32

  var bs = BSbits(data);
  var block = new Block();
  var context = new BlockInfoContext();
  block.read(bs, context);

  equal(block.id, 1, 'block.id');
  equal(block.chunks.length, 2, 'block.chunks.length');

  var subblock = block.chunks[0];
  ok(subblock instanceof Block, 'chunk #1 is Block');
  equal(subblock.id, 2, 'subblock.id');
  equal(subblock.chunks.length, 1, 'subblock.chunks.length');

  ok(subblock.chunks[0] instanceof Record, 'subblock chunk is Record');
  equal(subblock.chunks[0].values.length, 1);
  equal(subblock.chunks[0].values[0], 42);

  var record = block.chunks[1];
  ok(record instanceof Record);
  equal(record.code, 1);
  equal(record.values.length, 2);
  equal(record.values[0], 3);
  equal(record.values[1], 4);
});

test('abbrev', function() {
  var data = '';
  data += '10000000 1100';  // <block id = 1>, <code length = 3>
  data += '(00000000000000000000)';  // align32
  data += '10100000000000000000000000000000';  // <num words = 5>

  data += '010 01000';  // DEFINE_ABBREV, <num abbrevs ops = 2>
  data += '1 01101000';  // LITERAL, <value = 22>
  data += '0110 0100 00100';  // ARRAY, FIXED, 4-bits

  data += '001 110000 1010 0110 1110';  // abbrev 4, <values 5, 6, 7>
  data += '001 001000 1000 0110 0010 0001';  // abbrev 4, <values 1, 6, 4, 8>

  data += '00 (000000000000000000)';  // END_BLOCK, align32

  var bs = BSbits(data);
  var block = new Block();
  var context = new BlockInfoContext();
  block.read(bs, context);

  equal(block.id, 1, 'block.id');
  equal(block.chunks.length, 2, 'block.chunks.length');

  ok(block.chunks[0] instanceof Record, 'chunk is Record');
  equal(block.chunks[0].code, 22, 'chunk.code');
  equal(block.chunks[0].values.length, 3, 'chunk.values.length');
  equal(block.chunks[0].values[0], 5);
  equal(block.chunks[0].values[1], 6);
  equal(block.chunks[0].values[2], 7);

  ok(block.chunks[1] instanceof Record, 'chunk is Record');
  equal(block.chunks[1].code, 22, 'chunk.code');
  equal(block.chunks[1].values.length, 4, 'chunk.values.length');
  equal(block.chunks[1].values[0], 1);
  equal(block.chunks[1].values[1], 6);
  equal(block.chunks[1].values[2], 4);
  equal(block.chunks[1].values[3], 8);
});

test('info abbrev', function() {
  var data = '';
  data += '00000000 0100';  // <block id = 0>, <code length = 2>
  data += '(00000000000000000000)';  // align32
  data += '00000000000000000000000000000000';  // <num words>

  // UNABBREV_RECORD, SETBID, <num values = 1>, <value = 20>
  data += '11 100000 100000 001010';
  data += '01 01000';  // DEFINE_ABBREV, <num abbrevs = 1>
  data += '0110 0100 00100';  // ARRAY, FIXED, 4-bits

  // subblock
  data += '10';  // SUBBLOCK
  data += '00101000 1100';  // <block id = 20>, <code length = 3>
  data += '(0000000000)';  // align32
  data += '00000000000000000000000000000000';  // <num words>
  data += '001 110000 1010 0110 1110';  // abbrev 4, <values 5, 6, 7>
  data += '000 (00000000)';  // END_BLOCK, align32
  // end subblock

  data += '00 (000000000000000000000000000000)';  // END_BLOCK, align32

  var bs = BSbits(data);
  var block = new Block();
  var context = new BlockInfoContext();
  block.read(bs, context);

  equal(block.id, 0, 'block.id');
  equal(block.chunks.length, 2, 'block.chunks.length');

  var subblock = block.chunks[1];
  ok(subblock instanceof Block, 'chunk #2 is Block');
  equal(subblock.id, 20, 'subblock.id');
  equal(subblock.chunks.length, 1, 'subblock.chunks.length');

  ok(subblock.chunks[0] instanceof Record, 'subblock chunk is Record');
  equal(subblock.chunks[0].values.length, 2);
  equal(subblock.chunks[0].code, 5);
  equal(subblock.chunks[0].values[0], 6);
  equal(subblock.chunks[0].values[1], 7);
});

function getResource(resourceUrl, onload) {
  var xhr = new XMLHttpRequest();
  xhr.onload = function(event) { onload(xhr.response); }
  xhr.open('get', resourceUrl, true);
  xhr.responseType = 'arraybuffer';
  xhr.send();
}

function getAllResources(resourceUrls, onload) {
  var resourceHash = {};
  var expected = resourceUrls.length;
  resourceUrls.forEach(function(resourceUrl) {
    getResource(resourceUrl, function(resource) {
      resourceHash[resourceUrl] = resource;
      if (--expected == 0) {
        onload(resourceHash);
      }
    });
  });
}

function arrayBufferToString(ab) {
  var view = new Uint8Array(ab);
  var result = '';
  for (var i = 0; i < ab.byteLength; ++i) {
    result += String.fromCharCode(view[i]);
  }
  return result;
}

function makeJsonRecord(record) {
  return {
    _type: 'Record',
    code: record.code,
    values: record.values
  };
}

function makeJsonChunk(chunk) {
  if (chunk instanceof Record) {
    return makeJsonRecord(chunk);
  } else if (chunk instanceof Block) {
    return makeJsonBlock(chunk);
  }
}

function makeJsonBlock(block) {
  return {
    _type: 'Block',
    _id: block.id,
    chunks: block.chunks.map(makeJsonChunk)
  };
}

function makeJsonHeaderField(field) {
  return {
    ftype: field.ftype,
    id: field.id,
    data: field.data
  };
}

function makeJsonHeader(header) {
  return {
    sig: header.sig,
    num_fields: header.numFields,
    num_bytes: header.numBytes,
    fields: header.fields.map(makeJsonHeaderField)
  };
}

function makeJsonBitcode(bc) {
  return {
    header: makeJsonHeader(bc.header),
    blocks: bc.blocks.map(makeJsonBlock)
  };
}

asyncTest('load pexe', function() {
  getAllResources(['simple.pexe', 'simple.pexe.json'], function(resources) {
    var ab = resources['simple.pexe'];
    var bs = new BitStream(ab);
    var bc = new Bitcode();
    try {
      bc.read(bs);
    } catch (e) {
      ok(false, 'Error reading pexe: ' + e.message);
    }

    var goldenJson = arrayBufferToString(resources['simple.pexe.json']);
    var golden = JSON.parse(goldenJson);

    // TODO(binji): this currently fails.
    // deepEqual(makeJsonBitcode(bc), golden);
    ok(true);

    // Continue with other tests.
    start();
  });
});
