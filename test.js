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
  deepEqual(op.readAbbrev(bs), 'h'.charCodeAt(0));
  deepEqual(op.readAbbrev(bs), 'e'.charCodeAt(0));
  deepEqual(op.readAbbrev(bs), 'l'.charCodeAt(0));
  deepEqual(op.readAbbrev(bs), 'l'.charCodeAt(0));
  deepEqual(op.readAbbrev(bs), 'o'.charCodeAt(0));
});

test('blob abbrev op', function() {
  var op = new BlobAbbrevOp();
  // The first 6 bits are the number of bytes to read. The data follows after a
  // 32-bit alignment (the zero bits in parentheses below).
  var bs = BSbits(
      '110000 (00 00000000 00000000 00000000) 01010100 11001100 11100010');
  deepEqual(op.readAbbrev(bs), [42, 51, 71]);
});
