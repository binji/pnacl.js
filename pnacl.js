// Copyright (c) 2014 The Native Client Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
"use strict";

function Error(msg) {
  this.message = msg;
}

function resizeArrayBuffer(ab, newLen) {
  var abView = new Uint8Array(ab);
  var newAb = new ArrayBuffer(newLen);
  var newAbView = new Uint8Array(newAb);
  if (newLen >= ab.byteLength)
    newAbView.set(abView);
  else
    newAbView.set(abView.subarray(0, newLen));
  return newAb;
}

function BitStream(data) {
  // Pad data out to 32-bits, with an additional 32-bits (so we don't have to
  // worry about reading a little past the end).
  this.byteLength = data.byteLength;
  var newDataLen = this.byteLength + ((4 - this.byteLength & 3) & 3);
  data = resizeArrayBuffer(data, newDataLen);
  this.dataView = new Uint32Array(data);
  this.curword = 0;
  this.curwordBits = 0;
  this.bitOffset = 0;
}

BitStream.prototype._readFracBits = function(numBits) {
  var result;
  // Special case 32-bits because any shift >= 32 bits is ignored in JavaScript.
  if (numBits === 32) {
    result = this.curword;
    this.curword = 0;
  } else {
    result = this.curword & ((1 << numBits) - 1);
    this.curword >>= numBits;
  }
  this.curwordBits -= numBits;
  this.bitOffset += numBits;
  return result;
};

BitStream.prototype._fillCurWord = function() {
  var byteOffset = this.bitOffset >> 3;
  if (byteOffset >= this.byteLength) {
    var msg = '_fillCurWord: out of range. byteOffset =' +
        byteOffset + ' max =' + this.byteLength;
    throw new Error(msg);
  }
  var u32offset = byteOffset >> 2;
  this.curword = this.dataView[u32offset];
  if (byteOffset + 4 < this.byteLength)
    this.curwordBits = 32;
  else
    this.curwordBits = (this.byteLength - byteOffset) * 8;
};

BitStream.prototype.read = function(numBits) {
  if (numBits <= this.curwordBits)
    return this._readFracBits(numBits);

  var result = this.curword;
  var bits_read = this.curwordBits;
  var bits_left = numBits - this.curwordBits;
  this.bitOffset += bits_read;
  this._fillCurWord();
  result |= this._readFracBits(bits_left) << bits_read;
  return result;
};

BitStream.prototype.readVbr = function(numBits) {
  var piece = this.read(numBits);
  var hiMask = 1 << (numBits - 1);
  if ((piece & hiMask) === 0)
    return piece;

  var loMask = hiMask - 1;
  var result = 0;
  var shift = 0;
  while (1) {
    result |= (piece & loMask) << shift;
    if ((piece & hiMask) === 0)
      return result;
    shift += numBits - 1;
    piece = this.read(numBits);
  }
};

BitStream.prototype.readBytes = function(numBytes) {
  var result = [];
  for (var i = 0; i < numBytes; ++i)
    result.push(this.read(8));
  return result;
};

BitStream.prototype.tellBit = function() {
  return this.bitOffset;
};

BitStream.prototype.seekBit = function(offset) {
  this.bitOffset = offset & ~31;
  if (offset === this.byteLength << 3) {
    // Seeking to the end of the array is fine, but don't try to fill the
    // current word.
    this.curWordBits = 0;
    return;
  }
  this._fillCurWord();

  // offset is not aligned, read the unaligned bits.
  offset &= 31;
  if (offset)
    this._readFracBits(offset);
};

BitStream.prototype.align32 = function() {
  this.seekBit((this.tellBit() + 31) & ~31);
};

BitStream.prototype.atEnd = function() {
  var byteOffset = this.bitOffset >> 3;
  return byteOffset === this.byteLength;
};


function HeaderField() {
  this.ftype = null;
  this.id = null;
  this.data = null;
}

HeaderField.prototype.read = function(bs) {
  this.ftype = bs.read(4);
  this.id = bs.read(4);
  if (this.id !== 1)
    throw new Error('Bad header id ' + this.id);

  bs.read(8);  // Align to u16.
  var length = bs.read(16);

  if (this.ftype === 0)
    this.data = bs.readBytes(length);
  else if (this.ftype === 1)
    this.data = bs.read(32);
  else
    throw new Error('Bad ftype ' + this.ftype);
};

function Header() {
  this.sig = null;
  this.numFields = 0;
  this.numBytes = 0;
  this.fields = [];
}

Header.prototype.read = function(bs) {
  var match = function(c) {
    if (bs.read(8) !== c.charCodeAt(0))
      throw new Error('Bad signature');
  };
  match('P');
  match('E');
  match('X');
  match('E');

  this.sig = 'PEXE';
  this.numFields = bs.read(16);
  this.numBytes = bs.read(16);

  for (var i = 0; i < this.numFields; ++i) {
    var field = new HeaderField();
    field.read(bs);
    this.fields.push(field);
  }
};


var ENCODING_FIXED = 1
var ENCODING_VBR = 2
var ENCODING_ARRAY = 3
var ENCODING_CHAR6 = 4
var ENCODING_BLOB = 5

function readAbbrevOp(bs) {
  var isLiteral = bs.read(1);
  var op;
  if (isLiteral) {
    op = new LiteralAbbrevOp();
  } else {
    var encoding = bs.read(3);
    switch (encoding) {
      case ENCODING_FIXED: op = new FixedAbbrevOp(); break;
      case ENCODING_VBR:   op = new VbrAbbrevOp();   break;
      case ENCODING_ARRAY: op = new ArrayAbbrevOp(); break;
      case ENCODING_CHAR6: op = new Char6AbbrevOp(); break;
      case ENCODING_BLOB:  op = new BlobAbbrevOp();  break;
      default:
        throw new Error('Bad encoding ' + encoding);
    }
  }
  op.read(bs);
  return op;
}

function AbbrevOp() {}

AbbrevOp.prototype.read = function(bs) {};

AbbrevOp.prototype.readAbbrev = function(bs) {
  throw new Error('Function not implemented');
};

function LiteralAbbrevOp(value) {
  this.value = value ? value : null;
}

LiteralAbbrevOp.prototype = new AbbrevOp();

LiteralAbbrevOp.prototype.read = function(bs) {
  this.value = bs.readVbr(8);
};

LiteralAbbrevOp.prototype.readAbbrev = function(bs) {
  return [this.value];
};

function FixedAbbrevOp(numBits) {
  this.numBits = numBits ? numBits : 0;
}

FixedAbbrevOp.prototype = new AbbrevOp();

FixedAbbrevOp.prototype.read = function(bs) {
  this.numBits = bs.readVbr(5);
};

FixedAbbrevOp.prototype.readAbbrev = function(bs) {
  return [bs.read(this.numBits)];
};

function VbrAbbrevOp(numBits) {
  this.numBits = numBits ? numBits : 0;
}

VbrAbbrevOp.prototype = new AbbrevOp();

VbrAbbrevOp.prototype.read = function(bs) {
  this.numBits = bs.readVbr(5);
};

VbrAbbrevOp.prototype.readAbbrev = function(bs) {
  return [bs.readVbr(this.numBits)];
};

function ArrayAbbrevOp(eltOp) {
  if (eltOp && !(eltOp instanceof AbbrevOp))
    throw new Error('Expected eltOp to be instance of AbbrevOp');
  this.eltOp = eltOp ? eltOp : null;
}

ArrayAbbrevOp.prototype = new AbbrevOp();

ArrayAbbrevOp.prototype.read = function(bs) {
  this.eltOp = readAbbrevOp(bs);
};

ArrayAbbrevOp.prototype.readAbbrev = function(bs) {
  var numElts = bs.readVbr(6);
  var values = [];
  for (var i = 0; i < numElts; ++i) {
    this.eltOp.readAbbrev(bs).forEach(function(elt) {
      values.push(elt);
    });
  }
  return values;
};

var CHAR6 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._';

function Char6AbbrevOp() {}

Char6AbbrevOp.prototype = new AbbrevOp();

Char6AbbrevOp.prototype.readAbbrev = function(bs) {
  return CHAR6.charCodeAt(bs.read(6));
};

function BlobAbbrevOp() {}

BlobAbbrevOp.prototype = new AbbrevOp();

BlobAbbrevOp.prototype.readAbbrev = function(bs) {
  var numBytes = bs.read(6);
  bs.align32();
  var values = [];
  for (var i = 0; i < numBytes; ++i)
    values.push(bs.read(8));
  bs.align32();
  return values;
};

function Abbrev() {
  this.ops = [];
}

Abbrev.prototype.read = function(bs) {
  var numOps = bs.readVbr(5);
  var i = 0;
  while (i < numOps) {
    var op = readAbbrevOp(bs);
    this.ops.push(op);

    // Arrays use the following op as the element op.
    if (op instanceof ArrayAbbrevOp)
      i += 2;
    else
      i += 1;
  }
};


var BLOCKINFO_CODE_SETBID = 1
var BLOCKINFO_CODE_BLOCKNAME = 2
var BLOCKINFO_CODE_SETRECORDNAME = 3

function BlockInfoContext() {
  this.curBlockId = null;
  this.blockAbbrevs = {};
  this.blockNames = {};
  this.blockRecordNames = {};
}

BlockInfoContext.prototype.parseRecord = function(record) {
  switch (record.code) {
    case BLOCKINFO_CODE_SETBID:
      this.curBlockId = record.values[0];
      this.blockAbbrevs[this.curBlockId] = [];
      this.blockRecordNames[this.curBlockId] = [];
      break;
    case BLOCKINFO_CODE_BLOCKNAME:
      var name = record.values.map(String.fromCharCode).join('');
      this.blockNames[this.curBlockId] = name;
      break;
    case BLOCKINFO_CODE_SETRECORDNAME:
      var id = record.values[0];
      var name = record.values.slice(1).map(String.fromCharCode).join('');

      var array = this.blockRecordNames[this.curBlockId];
      if (array === undefined)
        this.blockRecordNames[this.curBlockId] = array = [];

      array.push([id, name]);
      break;
  }
};

BlockInfoContext.prototype.pushAbbrev = function(abbrev) {
  if (this.curBlockId === null)
    throw new Error('pushAbbrev: No block id set by SETBID');

  var array = this.blockAbbrevs[this.curBlockId];
  if (array === undefined)
    this.blockAbbrevs[this.curBlockId] = array = [];

  array.push(abbrev);
};

BlockInfoContext.prototype.getBlockAbbrevs = function(blockId) {
  var abbrevs = this.blockAbbrevs[blockId];
  return abbrevs ? abbrevs.slice() : [];
};


var ENTRY_END_BLOCK = 0
var ENTRY_SUBBLOCK = 1
var ENTRY_DEFINE_ABBREV = 2
var ENTRY_UNABBREV_RECORD = 3

function Record() {
  this.code = null;
  this.values = [];
}

Record.prototype.read = function(bs, abbrevId, abbrevs) {
  if (abbrevId === ENTRY_UNABBREV_RECORD) {
    this.code = bs.readVbr(6);
    var numElts = bs.readVbr(6);
    for (var i = 0; i < numElts; ++i)
      this.values.push(bs.readVbr(6));
  } else {
    var self = this;
    var abbrev = abbrevs[abbrevId - 4];  // -4 to skip abbrev defaults.
    if (abbrev === undefined)
      throw new Error('Invalid abbrev: ' + abbrevId);
    abbrev.ops.forEach(function(op) {
      op.readAbbrev(bs).forEach(function(value) {
        self.values.push(value);
      });
    });
    this.code = this.values[0];
    this.values = this.values.slice(1);
  }
};


function Block() {
  this.id = null;
  this.chunks = [];
}

Block.prototype.read = function(bs, context) {
  this.id = bs.readVbr(8);
  var codelen = bs.readVbr(4);
  bs.align32();
  var numWords = bs.read(32);

  // Add abbreviations for this block id.
  var abbrevs = context.getBlockAbbrevs(this.id);

  // The "block info" block is special. It has id 0, and any abbreviations
  // defined apply to its current block id, which is specified with a
  // unabbreviated record. See BlockInfoContext above for more info.
  var isBlockInfo = this.id === 0;

  while (!bs.atEnd()) {
    var entry = bs.read(codelen);
    if (entry === ENTRY_END_BLOCK) {
      bs.align32();
      return;
    } else if (entry === ENTRY_SUBBLOCK) {
      var block = new Block();
      block.read(bs, context);
      this.chunks.push(block);
    } else if (entry === ENTRY_DEFINE_ABBREV) {
      var abbrev = new Abbrev();
      abbrev.read(bs);
      abbrevs.push(abbrev);
      if (isBlockInfo)
        context.pushAbbrev(abbrev);
    } else {
      // Abbrev or UNABBREV_RECORD
      var record = new Record();
      record.read(bs, entry, abbrevs);
      this.chunks.push(record);
      if (isBlockInfo)
        context.parseRecord(record);
    }
  }
};

function Bitcode() {
  this.header = new Header();
  this.blocks = [];
}

Bitcode.prototype.read = function(bs) {
  var context = new BlockInfoContext();
  this.header.read(bs);
  while (!bs.atEnd()) {
    var entry = bs.read(2);
    if (entry != ENTRY_SUBBLOCK)
      throw new Error('Expected subblock at top-level, not ' + entry);
    var block = new Block();
    block.read(bs, context);
    this.blocks.push(block);
  }
};
