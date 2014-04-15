// Copyright (c) 2014 The Native Client Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
//
// Inspired by Google Closure Long (see
// https://code.google.com/p/closure-library/source/browse/closure/goog/math/long.js)
// with the following copyright:
//
// Copyright 2009 The Closure Library Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS-IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License./
"use strict";

function U64(low, high) {
  this.low_ = low | 0;
  this.high_ = high | 0;
};

U64.IntCache_ = {};

U64.fromInt = function(value) {
  if (-128 <= value && value < 128) {
    var cachedObj = U64.IntCache_[value];
    if (cachedObj) {
      return cachedObj;
    }
  }

  var obj = new U64(value | 0, value < 0 ? -1 : 0);
  if (-128 <= value && value < 128) {
    U64.IntCache_[value] = obj;
  }
  return obj;
};

U64.fromNumber = function(value) {
  if (isNaN(value) || !isFinite(value)) {
    return U64.ZERO;
  } else if (value <= -U64.TWO_PWR_63_DBL_) {
    return U64.MIN_VALUE;
  } else if (value + 1 >= U64.TWO_PWR_63_DBL_) {
    return U64.MAX_VALUE;
  } else if (value < 0) {
    return U64.fromNumber(-value).negate();
  } else {
    return new U64(
        (value % U64.TWO_PWR_32_DBL_) | 0,
        (value / U64.TWO_PWR_32_DBL_) | 0);
  }
};

U64.fromBits = function(low, high) {
  return new U64(low, high);
};

U64.TWO_PWR_16_DBL_ = 1 << 16;
U64.TWO_PWR_32_DBL_ = U64.TWO_PWR_16_DBL_ * U64.TWO_PWR_16_DBL_;
U64.TWO_PWR_64_DBL_ = U64.TWO_PWR_32_DBL_ * U64.TWO_PWR_32_DBL_;
U64.TWO_PWR_63_DBL_ = U64.TWO_PWR_64_DBL_ / 2;
U64.ZERO = U64.fromInt(0);
U64.ONE = U64.fromInt(1);
U64.NEG_ONE = U64.fromInt(-1);
U64.MAX_VALUE = U64.fromBits(0xFFFFFFFF | 0, 0x7FFFFFFF | 0);
U64.MIN_VALUE = U64.fromBits(0, 0x80000000 | 0);
U64.TWO_PWR_24_ = U64.fromInt(1 << 24);

/** @return {number} The value, assuming it is a 32-bit integer. */
U64.prototype.toInt = function() {
  return this.low_;
};


/** @return {number} The closest floating-point representation to this value. */
U64.prototype.toNumber = function() {
  return this.high_ * U64.TWO_PWR_32_DBL_ +
         this.getLowBitsUnsigned();
};


/**
 * @param {number=} opt_radix The radix in which the text should be written.
 * @return {string} The textual representation of this value.
 * @override
 */
U64.prototype.toString = function(opt_radix) {
  var radix = opt_radix || 10;
  if (radix < 2 || 36 < radix) {
    throw Error('radix out of range: ' + radix);
  }

  if (this.isZero()) {
    return '0';
  }

  if (this.isNegative()) {
    if (this.equals(U64.MIN_VALUE)) {
      // We need to change the Long value before it can be negated, so we remove
      // the bottom-most digit in this base and then recurse to do the rest.
      var radixLong = U64.fromNumber(radix);
      var div = this.div(radixLong);
      var rem = div.multiply(radixLong).subtract(this);
      return div.toString(radix) + rem.toInt().toString(radix);
    } else {
      return '-' + this.negate().toString(radix);
    }
  }

  // Do several (6) digits each time through the loop, so as to
  // minimize the calls to the very expensive emulated div.
  var radixToPower = U64.fromNumber(Math.pow(radix, 6));

  var rem = this;
  var result = '';
  while (true) {
    var remDiv = rem.div(radixToPower);
    var intval = rem.subtract(remDiv.multiply(radixToPower)).toInt();
    var digits = intval.toString(radix);

    rem = remDiv;
    if (rem.isZero()) {
      return digits + result;
    } else {
      while (digits.length < 6) {
        digits = '0' + digits;
      }
      result = '' + digits + result;
    }
  }
};


/** @return {number} The high 32-bits as a signed value. */
U64.prototype.getHighBits = function() {
  return this.high_;
};


/** @return {number} The low 32-bits as a signed value. */
U64.prototype.getLowBits = function() {
  return this.low_;
};


/** @return {number} The low 32-bits as an unsigned value. */
U64.prototype.getLowBitsUnsigned = function() {
  return (this.low_ >= 0) ?
      this.low_ : U64.TWO_PWR_32_DBL_ + this.low_;
};


/**
 * @return {number} Returns the number of bits needed to represent the absolute
 *     value of this Long.
 */
U64.prototype.getNumBitsAbs = function() {
  if (this.isNegative()) {
    if (this.equals(U64.MIN_VALUE)) {
      return 64;
    } else {
      return this.negate().getNumBitsAbs();
    }
  } else {
    var val = this.high_ != 0 ? this.high_ : this.low_;
    for (var bit = 31; bit > 0; bit--) {
      if ((val & (1 << bit)) != 0) {
        break;
      }
    }
    return this.high_ != 0 ? bit + 33 : bit + 1;
  }
};


/** @return {boolean} Whether this value is zero. */
U64.prototype.isZero = function() {
  return this.high_ == 0 && this.low_ == 0;
};


/** @return {boolean} Whether this value is negative. */
U64.prototype.isNegative = function() {
  return this.high_ < 0;
};


/** @return {boolean} Whether this value is odd. */
U64.prototype.isOdd = function() {
  return (this.low_ & 1) == 1;
};


/**
 * @param {U64} other Long to compare against.
 * @return {boolean} Whether this Long equals the other.
 */
U64.prototype.equals = function(other) {
  return (this.high_ == other.high_) && (this.low_ == other.low_);
};


/**
 * @param {U64} other Long to compare against.
 * @return {boolean} Whether this Long does not equal the other.
 */
U64.prototype.notEquals = function(other) {
  return (this.high_ != other.high_) || (this.low_ != other.low_);
};


/**
 * @param {U64} other Long to compare against.
 * @return {boolean} Whether this Long is less than the other.
 */
U64.prototype.lessThan = function(other) {
  return this.compare(other) < 0;
};


/**
 * @param {U64} other Long to compare against.
 * @return {boolean} Whether this Long is less than or equal to the other.
 */
U64.prototype.lessThanOrEqual = function(other) {
  return this.compare(other) <= 0;
};


/**
 * @param {U64} other Long to compare against.
 * @return {boolean} Whether this Long is greater than the other.
 */
U64.prototype.greaterThan = function(other) {
  return this.compare(other) > 0;
};


/**
 * @param {U64} other Long to compare against.
 * @return {boolean} Whether this Long is greater than or equal to the other.
 */
U64.prototype.greaterThanOrEqual = function(other) {
  return this.compare(other) >= 0;
};


/**
 * Compares this Long with the given one.
 * @param {U64} other Long to compare against.
 * @return {number} 0 if they are the same, 1 if the this is greater, and -1
 *     if the given one is greater.
 */
U64.prototype.compare = function(other) {
  if (this.equals(other)) {
    return 0;
  }

  var thisNeg = this.isNegative();
  var otherNeg = other.isNegative();
  if (thisNeg && !otherNeg) {
    return -1;
  }
  if (!thisNeg && otherNeg) {
    return 1;
  }

  // at this point, the signs are the same, so subtraction will not overflow
  if (this.subtract(other).isNegative()) {
    return -1;
  } else {
    return 1;
  }
};


/** @return {!U64} The negation of this value. */
U64.prototype.negate = function() {
  if (this.equals(U64.MIN_VALUE)) {
    return U64.MIN_VALUE;
  } else {
    return this.not().add(U64.ONE);
  }
};


/**
 * Returns the sum of this and the given Long.
 * @param {U64} other Long to add to this one.
 * @return {!U64} The sum of this and the given Long.
 */
U64.prototype.add = function(other) {
  // Divide each number into 4 chunks of 16 bits, and then sum the chunks.

  var a48 = this.high_ >>> 16;
  var a32 = this.high_ & 0xFFFF;
  var a16 = this.low_ >>> 16;
  var a00 = this.low_ & 0xFFFF;

  var b48 = other.high_ >>> 16;
  var b32 = other.high_ & 0xFFFF;
  var b16 = other.low_ >>> 16;
  var b00 = other.low_ & 0xFFFF;

  var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
  c00 += a00 + b00;
  c16 += c00 >>> 16;
  c00 &= 0xFFFF;
  c16 += a16 + b16;
  c32 += c16 >>> 16;
  c16 &= 0xFFFF;
  c32 += a32 + b32;
  c48 += c32 >>> 16;
  c32 &= 0xFFFF;
  c48 += a48 + b48;
  c48 &= 0xFFFF;
  return U64.fromBits((c16 << 16) | c00, (c48 << 16) | c32);
};


/**
 * Returns the difference of this and the given Long.
 * @param {U64} other Long to subtract from this.
 * @return {!U64} The difference of this and the given Long.
 */
U64.prototype.subtract = function(other) {
  return this.add(other.negate());
};


/**
 * Returns the product of this and the given long.
 * @param {U64} other Long to multiply with this.
 * @return {!U64} The product of this and the other.
 */
U64.prototype.multiply = function(other) {
  if (this.isZero()) {
    return U64.ZERO;
  } else if (other.isZero()) {
    return U64.ZERO;
  }

  if (this.equals(U64.MIN_VALUE)) {
    return other.isOdd() ? U64.MIN_VALUE : U64.ZERO;
  } else if (other.equals(U64.MIN_VALUE)) {
    return this.isOdd() ? U64.MIN_VALUE : U64.ZERO;
  }

  if (this.isNegative()) {
    if (other.isNegative()) {
      return this.negate().multiply(other.negate());
    } else {
      return this.negate().multiply(other).negate();
    }
  } else if (other.isNegative()) {
    return this.multiply(other.negate()).negate();
  }

  // If both longs are small, use float multiplication
  if (this.lessThan(U64.TWO_PWR_24_) &&
      other.lessThan(U64.TWO_PWR_24_)) {
    return U64.fromNumber(this.toNumber() * other.toNumber());
  }

  // Divide each long into 4 chunks of 16 bits, and then add up 4x4 products.
  // We can skip products that would overflow.

  var a48 = this.high_ >>> 16;
  var a32 = this.high_ & 0xFFFF;
  var a16 = this.low_ >>> 16;
  var a00 = this.low_ & 0xFFFF;

  var b48 = other.high_ >>> 16;
  var b32 = other.high_ & 0xFFFF;
  var b16 = other.low_ >>> 16;
  var b00 = other.low_ & 0xFFFF;

  var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
  c00 += a00 * b00;
  c16 += c00 >>> 16;
  c00 &= 0xFFFF;
  c16 += a16 * b00;
  c32 += c16 >>> 16;
  c16 &= 0xFFFF;
  c16 += a00 * b16;
  c32 += c16 >>> 16;
  c16 &= 0xFFFF;
  c32 += a32 * b00;
  c48 += c32 >>> 16;
  c32 &= 0xFFFF;
  c32 += a16 * b16;
  c48 += c32 >>> 16;
  c32 &= 0xFFFF;
  c32 += a00 * b32;
  c48 += c32 >>> 16;
  c32 &= 0xFFFF;
  c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48;
  c48 &= 0xFFFF;
  return U64.fromBits((c16 << 16) | c00, (c48 << 16) | c32);
};


/**
 * Returns this Long divided by the given one.
 * @param {U64} other Long by which to divide.
 * @return {!U64} This Long divided by the given one.
 */
U64.prototype.div = function(other) {
  if (other.isZero()) {
    throw Error('division by zero');
  } else if (this.isZero()) {
    return U64.ZERO;
  }

  if (this.equals(U64.MIN_VALUE)) {
    if (other.equals(U64.ONE) ||
        other.equals(U64.NEG_ONE)) {
      return U64.MIN_VALUE;  // recall that -MIN_VALUE == MIN_VALUE
    } else if (other.equals(U64.MIN_VALUE)) {
      return U64.ONE;
    } else {
      // At this point, we have |other| >= 2, so |this/other| < |MIN_VALUE|.
      var halfThis = this.shiftRight(1);
      var approx = halfThis.div(other).shiftLeft(1);
      if (approx.equals(U64.ZERO)) {
        return other.isNegative() ? U64.ONE : U64.NEG_ONE;
      } else {
        var rem = this.subtract(other.multiply(approx));
        var result = approx.add(rem.div(other));
        return result;
      }
    }
  } else if (other.equals(U64.MIN_VALUE)) {
    return U64.ZERO;
  }

  if (this.isNegative()) {
    if (other.isNegative()) {
      return this.negate().div(other.negate());
    } else {
      return this.negate().div(other).negate();
    }
  } else if (other.isNegative()) {
    return this.div(other.negate()).negate();
  }

  // Repeat the following until the remainder is less than other:  find a
  // floating-point that approximates remainder / other *from below*, add this
  // into the result, and subtract it from the remainder.  It is critical that
  // the approximate value is less than or equal to the real value so that the
  // remainder never becomes negative.
  var res = U64.ZERO;
  var rem = this;
  while (rem.greaterThanOrEqual(other)) {
    // Approximate the result of division. This may be a little greater or
    // smaller than the actual value.
    var approx = Math.max(1, Math.floor(rem.toNumber() / other.toNumber()));

    // We will tweak the approximate result by changing it in the 48-th digit or
    // the smallest non-fractional digit, whichever is larger.
    var log2 = Math.ceil(Math.log(approx) / Math.LN2);
    var delta = (log2 <= 48) ? 1 : Math.pow(2, log2 - 48);

    // Decrease the approximation until it is smaller than the remainder.  Note
    // that if it is too large, the product overflows and is negative.
    var approxRes = U64.fromNumber(approx);
    var approxRem = approxRes.multiply(other);
    while (approxRem.isNegative() || approxRem.greaterThan(rem)) {
      approx -= delta;
      approxRes = U64.fromNumber(approx);
      approxRem = approxRes.multiply(other);
    }

    // We know the answer can't be zero... and actually, zero would cause
    // infinite recursion since we would make no progress.
    if (approxRes.isZero()) {
      approxRes = U64.ONE;
    }

    res = res.add(approxRes);
    rem = rem.subtract(approxRem);
  }
  return res;
};


/**
 * Returns this Long modulo the given one.
 * @param {U64} other Long by which to mod.
 * @return {!U64} This Long modulo the given one.
 */
U64.prototype.modulo = function(other) {
  return this.subtract(this.div(other).multiply(other));
};


/** @return {!U64} The bitwise-NOT of this value. */
U64.prototype.not = function() {
  return U64.fromBits(~this.low_, ~this.high_);
};


/**
 * Returns the bitwise-AND of this Long and the given one.
 * @param {U64} other The Long with which to AND.
 * @return {!U64} The bitwise-AND of this and the other.
 */
U64.prototype.and = function(other) {
  return U64.fromBits(this.low_ & other.low_,
                                 this.high_ & other.high_);
};


/**
 * Returns the bitwise-OR of this Long and the given one.
 * @param {U64} other The Long with which to OR.
 * @return {!U64} The bitwise-OR of this and the other.
 */
U64.prototype.or = function(other) {
  return U64.fromBits(this.low_ | other.low_,
                                 this.high_ | other.high_);
};


/**
 * Returns the bitwise-XOR of this Long and the given one.
 * @param {U64} other The Long with which to XOR.
 * @return {!U64} The bitwise-XOR of this and the other.
 */
U64.prototype.xor = function(other) {
  return U64.fromBits(this.low_ ^ other.low_,
                                 this.high_ ^ other.high_);
};


/**
 * Returns this Long with bits shifted to the left by the given amount.
 * @param {number} numBits The number of bits by which to shift.
 * @return {!U64} This shifted to the left by the given amount.
 */
U64.prototype.shiftLeft = function(numBits) {
  numBits &= 63;
  if (numBits == 0) {
    return this;
  } else {
    var low = this.low_;
    if (numBits < 32) {
      var high = this.high_;
      return U64.fromBits(
          low << numBits,
          (high << numBits) | (low >>> (32 - numBits)));
    } else {
      return U64.fromBits(0, low << (numBits - 32));
    }
  }
};


/**
 * Returns this Long with bits shifted to the right by the given amount.
 * @param {number} numBits The number of bits by which to shift.
 * @return {!U64} This shifted to the right by the given amount.
 */
U64.prototype.shiftRight = function(numBits) {
  numBits &= 63;
  if (numBits == 0) {
    return this;
  } else {
    var high = this.high_;
    if (numBits < 32) {
      var low = this.low_;
      return U64.fromBits(
          (low >>> numBits) | (high << (32 - numBits)),
          high >> numBits);
    } else {
      return U64.fromBits(
          high >> (numBits - 32),
          high >= 0 ? 0 : -1);
    }
  }
};


/**
 * Returns this Long with bits shifted to the right by the given amount, with
 * zeros placed into the new leading bits.
 * @param {number} numBits The number of bits by which to shift.
 * @return {!U64} This shifted to the right by the given amount, with
 *     zeros placed into the new leading bits.
 */
U64.prototype.shiftRightUnsigned = function(numBits) {
  numBits &= 63;
  if (numBits == 0) {
    return this;
  } else {
    var high = this.high_;
    if (numBits < 32) {
      var low = this.low_;
      return U64.fromBits(
          (low >>> numBits) | (high << (32 - numBits)),
          high >>> numBits);
    } else if (numBits == 32) {
      return U64.fromBits(high, 0);
    } else {
      return U64.fromBits(high >>> (numBits - 32), 0);
    }
  }
};

