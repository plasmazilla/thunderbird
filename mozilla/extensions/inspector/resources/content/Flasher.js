/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is mozilla.org code.
 *
 * The Initial Developer of the Original Code is
 * Netscape Communications Corporation.
 * Portions created by the Initial Developer are Copyright (C) 2001
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Joe Hewitt <hewitt@netscape.com> (original author)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

/***************************************************************
* Flasher ---------------------------------------------------
*   Object for controlling a timed flashing animation which 
*   paints a border around an element.
* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 
* REQUIRED IMPORTS:
****************************************************************/

//////////// global variables /////////////////////

var gFlasherRegistry = [];

//////////// global constants ////////////////////

////////////////////////////////////////////////////////////////////////////
//// class Flasher

function Flasher(aColor, aThickness, aDuration, aSpeed, aInvert)
{
  this.mShell = XPCU.getService("@mozilla.org/inspector/flasher;1", "inIFlasher");
  this.mShell.color = aColor;
  this.mShell.thickness = aThickness;
  this.mShell.invert = aInvert;
  this.duration = aDuration;
  this.mSpeed = aSpeed;
  
  this.register();
}

Flasher.prototype = 
{
  ////////////////////////////////////////////////////////////////////////////
  //// Initialization

  mFlashTimeout: null,
  mElement:null,
  mRegistryId: null,
  mFlashes: 0,
  mStartTime: 0,
  mDuration: 0,
  mSpeed: 0,

  ////////////////////////////////////////////////////////////////////////////
  //// Properties

  get flashing() { return this.mFlashTimeout != null; },
  
  get element() { return this.mElement; },
  set element(val) 
  { 
    if (val && val.nodeType == Node.ELEMENT_NODE) {
      this.mElement = val; 
      this.mShell.scrollElementIntoView(val);
    } else 
      throw "Invalid node type.";
  },

  get color() { return this.mShell.color; },
  set color(aVal) { return this.mShell.color = aVal; },

  get thickness() { return this.mShell.thickness; },
  set thickness(aVal) { this.mShell.thickness = aVal; },

  get duration() { return this.mDuration; },
  set duration(aVal) { this.mDuration = aVal; },

  get speed() { return this.mSpeed; },
  set speed(aVal) { this.mSpeed = aVal; },

  get invert() { return this.mShell.invert; },
  set invert(aVal) { this.mShell.invert = aVal; },

  // :::::::::::::::::::::::::::::::::::::::::::::::::::::::::
  // :::::::::::::::::::: Methods ::::::::::::::::::::::::::::
  // :::::::::::::::::::::::::::::::::::::::::::::::::::::::::

  register: function()
  {
    var length = gFlasherRegistry.length;
    gFlasherRegistry[length] = this;
    this.mRegistryId = length;
  },

  start: function(aDuration, aSpeed, aHold)
  {
    this.mUDuration = aDuration ? aDuration*1000 : this.mDuration;
    this.mUSpeed = aSpeed ? aSpeed : this.mSpeed
    this.mHold = aHold;
    this.mFlashes = 0;
    this.mStartTime = new Date();
    this.doFlash();
  },

  doFlash: function()
  {
    if (this.mHold || this.mFlashes%2) {
      this.paintOn();
    } else {
      this.paintOff();
    }
    this.mFlashes++;

    if (this.mUDuration < 0 || new Date() - this.mStartTime < this.mUDuration) {
      this.mFlashTimeout = window.setTimeout("gFlasherRegistry["+this.mRegistryId+"].doFlash()", this.mUSpeed);
    } else {
      this.stop();
    }
},

  stop: function()
  {
    if (this.flashing) {
      window.clearTimeout(this.mFlashTimeout);
      this.mFlashTimeout = null;
      this.paintOff();
    }
  },

  paintOn: function()
  {
    this.mShell.drawElementOutline(this.mElement);
  },

  paintOff: function()
  {
    this.mShell.repaintElement(this.mElement);
  }

};

////////////////////////////////////////////////////////////////////////////////
//// DOMIFlasher

/**
 * The special version of the flasher operating with DOM Inspector flasher
 * preferences.
 */
function DOMIFlasher()
{
  this.init();
}

DOMIFlasher.prototype =
{
  //////////////////////////////////////////////////////////////////////////////
  //// Public

  get flashOnSelect() { return PrefUtils.getPref("inspector.blink.on"); },
  set flashOnSelect(aVal) { PrefUtils.setPref("inspector.blink.on", aVal); },

  get color() { return PrefUtils.getPref("inspector.blink.border-color"); },
  set color(aVal) { PrefUtils.setPref("inspector.blink.border-color", aVal); },

  get thickness() { return PrefUtils.getPref("inspector.blink.border-width"); },
  set thickness(aVal) { PrefUtils.setPref("inspector.blink.border-width", aVal); },

  get duration() { return PrefUtils.getPref("inspector.blink.duration"); },
  set duration(aVal) { PrefUtils.setPref("inspector.blink.duration", aVal); },

  get speed() { return PrefUtils.getPref("inspector.blink.speed"); },
  set speed(aVal) { PrefUtils.setPref("inspector.blink.speed", aVal); },

  get invert() { return PrefUtils.getPref("inspector.blink.invert"); },
  set invert(aVal) { PrefUtils.setPref("inspector.blink.invert", aVal); },

  flashElement: function DOMIFlasher_flashElement(aElement)
  {
    if (this.mFlasher.flashing)
      this.mFlasher.stop();

    this.mFlasher.element = aElement;
    this.mFlasher.start();
  },

  flashElementOnSelect: function DOMIFlasher_flashElementOnSelect(aElement)
  {
    if (this.flashOnSelect) {
      this.flashElement(aElement);
    }
  },

  destroy: function DOMIFlasher_destroy()
  {
    PrefUtils.removeObserver("inspector.blink.", this);
  },

  //////////////////////////////////////////////////////////////////////////////
  //// Private

  init: function DOMIFlasher_init()
  {
    this.mFlasher = new Flasher(this.color, this.thickness, this.duration,
                                this.speed, this.invert);

    PrefUtils.addObserver("inspector.blink.", this);

    this.updateFlashOnSelectCommand();
  },

  updateFlashOnSelectCommand: function DOMIFlasher_updateFlashOnSelectCommand()
  {
    var cmdEl = document.getElementById("cmdFlashOnSelect");
    if (this.flashOnSelect) {
      cmdEl.setAttribute("checked", "true");
    } else {
      cmdEl.removeAttribute("checked");
    }
  },

  observe: function DOMIFlasher_observe(aSubject, aTopic, aData)
  {
    if (aData == "inspector.blink.on") {
      this.updateFlashOnSelectCommand();
      return;
    }

    var value = PrefUtils.getPref(aData);

    if (aData == "inspector.blink.border-color") {
      this.mFlasher.color = value;
    } else if (aData == "inspector.blink.border-width") {
      this.mFlasher.thickness = value;
    } else if (aData == "inspector.blink.duration") {
      this.mFlasher.duration = value;
    } else if (aData == "inspector.blink.speed") {
      this.mFlasher.speed = value;
    } else if (aData == "inspector.blink.invert") {
      this.mFlasher.invert = value;
    }
  }
}
