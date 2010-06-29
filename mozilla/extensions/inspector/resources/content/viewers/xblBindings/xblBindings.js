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

/*****************************************************************************
* XBLBindingsViewer ----------------------------------------------------------
*  Inspects the XBL bindings for a given element, including anonymous content,
*  methods, properties, event handlers, and resources.
* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
* REQUIRED IMPORTS:
*   chrome://inspector/content/jsutil/xpcom/XPCU.js
*****************************************************************************/

//////////////////////////////////////////////////////////////////////////////
//// Global Variables

var viewer;

//////////////////////////////////////////////////////////////////////////////
//// Global Constants

const kDOMViewContractID = "@mozilla.org/inspector/dom-view;1";
const kDOMUtilsContractID = "@mozilla.org/inspector/dom-utils;1";
const kXBLNSURI = "http://www.mozilla.org/xbl";

//////////////////////////////////////////////////////////////////////////////

window.addEventListener("load", XBLBindingsViewer_initialize, false);

function XBLBindingsViewer_initialize()
{
  viewer = new XBLBindingsViewer();
  viewer.initialize(parent.FrameExchange.receiveData(window));
}

//////////////////////////////////////////////////////////////////////////////
//// Class XBLBindingsViewer

function XBLBindingsViewer()
{
  this.mURL = window.location;
  this.mObsMan = new ObserverManager(this);
  this.mDOMUtils = XPCU.getService(kDOMUtilsContractID, "inIDOMUtils");

  this.mContentTree = document.getElementById("olContent");
  this.mMethodTree = document.getElementById("olMethods");
  this.mPropTree = document.getElementById("olProps");
  this.mHandlerTree = document.getElementById("olHandlers");
  this.mResourceTree = document.getElementById("olResources");

  // prepare and attach the content DOM datasource
  this.mContentView = XPCU.createInstance(kDOMViewContractID, "inIDOMView");
  this.mContentView.whatToShow &= ~(NodeFilter.SHOW_TEXT);
  this.mContentTree.view = this.mContentView;
}

XBLBindingsViewer.prototype =
{
  ////////////////////////////////////////////////////////////////////////////
  //// Initialization

  mSubject: null,
  mPane: null,

  ////////////////////////////////////////////////////////////////////////////
  //// Interface inIViewer

  get uid()
  {
    return "xblBindings";
  },

  get pane()
  {
    return this.mPane;
  },

  get subject()
  {
    return this.mSubject;
  },

  set subject(aObject)
  {
    this.mSubject = aObject;

    this.populateBindings();

    var menulist = document.getElementById("mlBindings");
    this.displayBinding(menulist.value);

    this.mObsMan.dispatchEvent("subjectChange", { subject: aObject });
  },

  initialize: function XBLBVr_Initialize(aPane)
  {
    this.mPane = aPane;

    aPane.notifyViewerReady(this);
  },

  destroy: function XBLBVr_Destroy()
  {
    this.mContentTree.view = null;
    this.mMethodTree.view = null;
    this.mPropTree.view = null;
    this.mHandlerTree.view = null;
    this.mResourceTree.view = null;
  },

  isCommandEnabled: function XBLBVr_IsCommandEnabled(aCommand)
  {
    return false;
  },

  getCommand: function XBLBVr_GetCommand(aCommand)
  {
    return null;
  },

  ////////////////////////////////////////////////////////////////////////////
  //// Event Dispatching

  addObserver: function XBLBVr_AddObserver(aEvent, aObserver)
  {
    this.mObsMan.addObserver(aEvent, aObserver);
  },

  removeObserver: function XBLBVr_RemoveObserver(aEvent, aObserver)
  {
    this.mObsMan.removeObserver(aEvent, aObserver);
  },

  ////////////////////////////////////////////////////////////////////////////
  //// Displaying Binding Info

  populateBindings: function XBLBVr_PopulateBindings()
  {
    var urls = this.mDOMUtils.getBindingURLs(this.mSubject);
    var menulist = document.getElementById("mlBindings");

    menulist.removeAllItems();

    var urlCount = urls.length;
    var i;

    for (i = 0; i < urlCount; ++i) {
      var url = urls.queryElementAt(i, Components.interfaces.nsIURI).spec;
      menulist.appendItem(url, url);
    }

    menulist.selectedIndex = 0;
  },

  displayBinding: function XBLBVr_DisplayBinding(aURL)
  {
    this.mBindingURL = aURL;
    if (aURL) {
      var req = new XMLHttpRequest();
      req.addEventListener("load", gDocLoadListener, true);
      req.open("GET", aURL);
      req.overrideMimeType("application/xml");
      req.send(null);
    }
    else {
      this.doDisplayBinding(null);
    }
  },

  doDisplayBinding: function XBLBVr_DoDisplayBinding(doc)
  {
    if (doc) {
      var url = this.mBindingURL;
      var poundPt = url.indexOf("#");
      var id = url.substr(poundPt + 1);
      var bindings = doc.getElementsByTagNameNS(kXBLNSURI, "binding");
      var binding = null;
      for (var i = 0; i < bindings.length; ++i) {
        if (bindings[i].getAttribute("id") == id) {
          binding = bindings[i];
          break;
        }
      }
      this.mBinding = binding;
    }
    else {
      this.mBinding = null;
    }

    this.displayContent();
    this.displayMethods();
    this.displayProperties();
    this.displayHandlers();
    this.displayResources();

    // switch to the first non-disabled tab if the one that's showing is
    // disabled, otherwise, you can't use the keyboard to switch tabs
    var tabbox = document.getElementById("bxBindingAspects");
    if (tabbox.selectedTab.disabled) {
      for (let i = 0; i < tabbox.tabs.childNodes.length; ++i) {
         if (!tabbox.tabs.childNodes[i].disabled) {
           tabbox.selectedTab = tabbox.tabs.childNodes[i];
           break;
         }
      }
    }

    document.getElementById("mlBindings").disabled = !this.mBinding;
  },

  displayContent: function XBLBVr_DisplayContent()
  {
    this.mContentView.rootNode = this.mBinding &&
      this.mBinding.getElementsByTagNameNS(kXBLNSURI, "content").item(0);
    this.mContentTree.disabled = !this.mContentView.rootNode;
    document.getElementById("tbContent").disabled =
      !this.mContentView.rootNode;
    if (this.mContentView.rootNode) {
      this.mContentTree.view.selection.select(0);
    }
  },

  displayMethods: function XBLBVr_DisplayMethods()
  {
    this.mMethodTree.view =
      this.mBinding ? new MethodTreeView(this.mBinding) : null;

    var active = this.mBinding &&
      this.mBinding.getElementsByTagNameNS(kXBLNSURI, "method").length > 0;
    this.mMethodTree.disabled = !active;
    document.getElementById("tbMethods").disabled = !active;
    if (active && this.mMethodTree.view.rowCount) {
      this.mMethodTree.view.selection.select(0);
    }
  },

  displayProperties: function XBLBVr_DisplayProperties()
  {
    this.mPropTree.view =
      this.mBinding ? new PropTreeView(this.mBinding) : null;

    var active = this.mBinding &&
      this.mBinding.getElementsByTagNameNS(kXBLNSURI, "property").length > 0;
    this.mPropTree.disabled = !active;
    document.getElementById("tbProps").disabled = !active;
    if (active && this.mPropTree.view.rowCount) {
      this.mPropTree.view.selection.select(0);
    }
  },

  displayHandlers: function XBLBVr_DisplayHandlers()
  {
    this.mHandlerTree.view =
      this.mBinding ? new HandlerTreeView(this.mBinding) : null;

    var active = this.mBinding &&
      this.mBinding.getElementsByTagNameNS(kXBLNSURI, "handler").length > 0;
    this.mHandlerTree.disabled = !active;
    document.getElementById("tbHandlers").disabled = !active;
    if (active && this.mHandlerTree.view.rowCount) {
      this.mHandlerTree.view.selection.select(0);
    }
  },

  displayResources: function XBLBVr_DisplayResources()
  {
    this.mResourceTree.view =
      this.mBinding ? new ResourceTreeView(this.mBinding) : null;

    var active = this.mBinding &&
      this.mBinding.getElementsByTagNameNS(kXBLNSURI, "resources").length > 0;
    document.getElementById("tbResources").disabled = !active;
    this.mResourceTree.disabled = !active;
  },

  displayMethod: function XBLBVr_DisplayMethod(aMethod)
  {
    var body = aMethod.getElementsByTagNameNS(kXBLNSURI, "body").item(0);
    document.getElementById("txbMethodCode").value = 
      this.justifySource(this.readDOMText(body));
  },

  displayProperty: function XBLBVr_DisplayProperty(aProp)
  {
    var rgroup = document.getElementById("rgPropGetterSetter");
    var getradio = document.getElementById("raPropGetter");
    var setradio = document.getElementById("raPropSetter");

    // disable/enable radio buttons
    getradio.disabled =
      !aProp || !(aProp.hasAttribute("onget") ||
                  aProp.getElementsByTagName("getter").length);
    setradio.disabled =
      !aProp || !(aProp.hasAttribute("onset") ||
                  aProp.getElementsByTagName("setter").length);

    // make sure a valid radio button is selected
    if (rgroup.selectedIndex < 0) {
      rgroup.selectedIndex = 0;
    }
    if (rgroup.selectedItem.disabled) {
      var other = rgroup.getItemAtIndex((rgroup.selectedIndex + 1) % 2);
      if (!other.disabled) {
        rgroup.selectedItem = other;
      }
    }

    // display text
    var et = rgroup.value;
    var text = "";
    if (et && aProp) {
      text = aProp.getAttribute("on" + et);
      if (!text) {
        kids = aProp.getElementsByTagNameNS(kXBLNSURI, et + "ter");
        text = this.readDOMText(kids.item(0));
      }
    }
    document.getElementById("txbPropCode").value = this.justifySource(text);
  },

  displayHandler: function XBLBVr_DisplayHandler(aHandler)
  {
    var text = "";
    if (aHandler) {
      text = aHandler.getAttribute("action") || this.readDOMText(aHandler);
    }
    document.getElementById("txbHandlerCode").value =
      this.justifySource(text);
  },

  ////////////////////////////////////////////////////////////////////////////
  //// Selection

  onMethodSelected: function XBLBVr_OnMethodSelected()
  {
    var idx = this.mMethodTree.currentIndex;
    var methods = this.mBinding.getElementsByTagNameNS(kXBLNSURI, "method");
    var method = methods[idx];
    this.displayMethod(method);
  },

  onPropSelected: function XBLBVr_OnPropSelected()
  {
    var idx = this.mPropTree.currentIndex;
    var props = this.mBinding.getElementsByTagNameNS(kXBLNSURI, "property");
    var prop = props[idx];
    this.displayProperty(prop);
  },

  onHandlerSelected: function XBLBVr_OnHandlerSelected()
  {
    var idx = this.mHandlerTree.currentIndex;
    var handlers = this.mBinding.getElementsByTagNameNS(kXBLNSURI, "handler");
    var handler = handlers[idx];
    this.displayHandler(handler);
  },

  ////////////////////////////////////////////////////////////////////////////
  //// Misc
  readDOMText: function XBLBVr_ReadDOMText(aEl)
  {
    if (!aEl) {
      return "";
    }

    var text = aEl.nodeValue || "";
    for (var i = 0; i < aEl.childNodes.length; ++i) {
      text += this.readDOMText(aEl.childNodes[i]);
    }
    return text;
  },

  // Remove newlines at the beginning of the string and the lowest level of
  // indentation from the beginning of each line, since most XBL getters,
  // setters, methods, and handlers are handwritten CDATA.
  justifySource: function XBLBVr_JustifySource(aStr)
  {
    // convert indentation to use spaces
    while (/^ *\t/m.test(aStr)) {
      aStr = aStr.replace(/^((        )*) {0,7}\t/gm, "$1        ");
    }
    // remove trailing spaces from all lines
    aStr = aStr.replace(/ +$/gm, "");
    // lose the trailing blank lines
    aStr = aStr.replace(/\n*$/, "");
    // lose the initial blank lines
    aStr = aStr.replace(/^\n*/, "");
    // now check if, for some crazy reason, there are lines in the rest of the
    // source at a lower indentation level than the first line
    var indentations = aStr.match(/^ *(?=[^\n])/gm);
    if (indentations) {
      indentations.sort();
      if (indentations[0]) {
        aStr = aStr.replace(RegExp("^" + indentations[0], "gm"), "");
      }
    }
    return aStr;
  }
};

//////////////////////////////////////////////////////////////////////////////
//// MethodTreeView

function MethodTreeView(aBinding)
{
  this.mMethods = aBinding.getElementsByTagNameNS(kXBLNSURI, "method");
  this.mRowCount = this.mMethods ? this.mMethods.length : 0;
}

MethodTreeView.prototype = new inBaseTreeView();

MethodTreeView.prototype.getCellText =
function MTV_GetCellText(aRow, aCol)
{
  if (aCol.id == "olcMethodName") {
    var method = this.mMethods[aRow];
    var name = method.getAttribute("name");
    var params = method.getElementsByTagNameNS(kXBLNSURI, "parameter");
    var pstr = "";
    if (params.length) {
      pstr += params[0].getAttribute("name");
    }
    for (var i = 1; i < params.length; ++i) {
      pstr += ", " + params[i].getAttribute("name");
    }
    return name + "(" + pstr + ")";
  }

  return "";
}

//////////////////////////////////////////////////////////////////////////////
//// PropTreeView

function PropTreeView(aBinding)
{
  this.mProps = aBinding.getElementsByTagNameNS(kXBLNSURI, "property");
  this.mRowCount = this.mProps ? this.mProps.length : 0;
}

PropTreeView.prototype = new inBaseTreeView();

PropTreeView.prototype.getCellText =
function PTV_GetCellText(aRow, aCol)
{
  if (aCol.id == "olcPropName") {
    return this.mProps[aRow].getAttribute("name");
  }

  return "";
}

//////////////////////////////////////////////////////////////////////////////
//// HandlerTreeView

function HandlerTreeView(aBinding)
{
  this.mHandlers = aBinding.getElementsByTagNameNS(kXBLNSURI, "handler");
  this.mRowCount = this.mHandlers ? this.mHandlers.length : 0;
}

HandlerTreeView.prototype = new inBaseTreeView();

HandlerTreeView.prototype.getCellText =
function HTV_GetCellText(aRow, aCol)
{
  var handler = this.mHandlers[aRow];
  if (aCol.id == "olcHandlerEvent") {
    return handler.getAttribute("event");
  }
  else if (aCol.id == "olcHandlerPhase") {
    return handler.getAttribute("phase");
  }

  return "";
}

//////////////////////////////////////////////////////////////////////////////
//// ResourceTreeView

function ResourceTreeView(aBinding)
{
  this.mResources = [];
  var res = aBinding.getElementsByTagNameNS(kXBLNSURI, "resources").item(0);
  if (res) {
    var kids = res.childNodes;
    for (var i = 0; i < kids.length; ++i) {
      if (kids[i].nodeType == Node.ELEMENT_NODE) {
        this.mResources.push(kids[i]);
      }
    }
  }

  this.mRowCount = this.mResources.length;
}

ResourceTreeView.prototype = new inBaseTreeView();

ResourceTreeView.prototype.getCellText =
function RTV_GetCellText(aRow, aCol)
{
  var resource = this.mResources[aRow];
  if (aCol.id == "olcResourceType") {
    return resource.localName;
  }
  else if (aCol.id == "olcResourceSrc") {
    return resource.getAttribute("src");
  }

  return "";
}

//////////////////////////////////////////////////////////////////////////////
//// Event Listeners

function gDocLoadListener(event)
{
  viewer.doDisplayBinding(event.target.responseXML);
}
