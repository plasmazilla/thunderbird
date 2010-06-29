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
 *   Jason Barnabe <jason_barnabe@fastmail.fm>
 *   Shawn Wilsher <me@shawnwilsher.com>
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
* DOMViewer ------------------------------------------------------------------
*  Views all nodes within a document.
* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
* REQUIRED IMPORTS:
*   chrome://global/content/XPCNativeWrapper.js
*   chrome://inspector/content/hooks.js
*   chrome://inspector/content/utils.js
*   chrome://inspector/content/jsutil/events/ObserverManager.js
*   chrome://inspector/content/jsutil/system/PrefUtils.js
*   chrome://inspector/content/jsutil/xpcom/XPCU.js
*   chrome://inspector/content/jsutil/xul/FrameExchange.js
*****************************************************************************/

//////////////////////////////////////////////////////////////////////////////
//// Global Variables

var viewer;

//////////////////////////////////////////////////////////////////////////////
//// Global Constants

const kDOMViewClassID             = "@mozilla.org/inspector/dom-view;1";
const kClipboardHelperClassID     = "@mozilla.org/widget/clipboardhelper;1";
const kPromptServiceClassID       = "@mozilla.org/embedcomp/prompt-service;1";
const kAccessibleRetrievalClassID = "@mozilla.org/accessibleRetrieval;1";
const kDOMUtilsClassID            = "@mozilla.org/inspector/dom-utils;1";
const kDeepTreeWalkerClassID      = "@mozilla.org/inspector/deep-tree-walker;1";
const nsIDOMNode                  = Components.interfaces.nsIDOMNode;
const nsIDOMElement               = Components.interfaces.nsIDOMElement;

//////////////////////////////////////////////////////////////////////////////

window.addEventListener("load", DOMViewer_initialize, false);
window.addEventListener("unload", DOMViewer_destroy, false);

function DOMViewer_initialize()
{
  viewer = new DOMViewer();
  viewer.initialize(parent.FrameExchange.receiveData(window));
}

function DOMViewer_destroy()
{
  PrefUtils.removeObserver("inspector", PrefChangeObserver);
  viewer.removeClickListeners();
  viewer = null;
}

//////////////////////////////////////////////////////////////////////////////
//// class DOMViewer

function DOMViewer() // implements inIViewer
{
  this.mObsMan = new ObserverManager(this);

  this.mDOMTree = document.getElementById("trDOMTree");
  this.mDOMTreeBody = document.getElementById("trDOMTreeBody");

  // prepare and attach the DOM DataSource
  this.mDOMView = XPCU.createInstance(kDOMViewClassID, "inIDOMView");
  this.mDOMView.showSubDocuments = true;
  // hide attribute nodes
  this.mDOMView.whatToShow &= ~(NodeFilter.SHOW_ATTRIBUTE);
  this.mDOMTree.treeBoxObject.view = this.mDOMView;

  PrefUtils.addObserver("inspector", PrefChangeObserver);
}

DOMViewer.prototype =
{
  mSubject: null,
  mDOMView: null,
  // searching stuff
  mFindResult: null,
  mColumns: null,
  mFindDir: null,
  mFindParams: null,
  mFindType: null,
  mFindWalker: null,
  mSelecting: false,

  ////////////////////////////////////////////////////////////////////////////
  //// interface inIViewer

  //// attributes

  get uid() {
    return "dom"
  },

  get pane() {
    return this.mPanel
  },

  get editable() {
    return true;
  },

  get selection() {
    return this.mSelection
  },

  get subject() {
    return this.mSubject
  },

  set subject(aObject) {
    this.mSubject = aObject;
    this.mDOMView.rootNode = aObject;
    this.mObsMan.dispatchEvent("subjectChange", { subject: aObject });
    this.setInitialSelection(aObject);
  },

  //// methods

  /**
   * Properly sets up the DOM Viewer
   *
   * @param aPane
   *        The panel this references.
   */
  initialize: function DVr_initialize(aPane)
  {
    this.mPanel = aPane;

    this.setAnonContent(PrefUtils.getPref("inspector.dom.showAnon"));
    this.setProcessingInstructions(
      PrefUtils.getPref("inspector.dom.showProcessingInstructions")
    );
    this.setAccessibleNodes(
      PrefUtils.getPref("inspector.dom.showAccessibleNodes")
    );
    this.setWhitespaceNodes(
      PrefUtils.getPref("inspector.dom.showWhitespaceNodes")
    );

    aPane.notifyViewerReady(this);
  },

  destroy: function DVr_Destroy()
  {
    this.mDOMTree.treeBoxObject.view = null;
  },

  isCommandEnabled: function DVr_IsCommandEnabled(aCommand)
  {
    var clipboardNode = null;
    var selectedNode = null;
    var parentNode = null;
    if (/^cmdEditPaste/.test(aCommand)) {
      if (this.mPanel.panelset.clipboardFlavor != "inspector/dom-node") {
        return false;
      }
      clipboardNode = this.mPanel.panelset.getClipboardData();
    }
    if (/^cmdEdit(Paste|Insert)/.test(aCommand)) {
      selectedNode = new XPCNativeWrapper(viewer.selectedNode, "nodeType",
                                          "parentNode", "childNodes");
      if (selectedNode.parentNode) {
        parentNode = new XPCNativeWrapper(selectedNode.parentNode,
                                          "nodeType");
      }
    }
    switch (aCommand) {
      case "cmdEditPaste":
      case "cmdEditPasteBefore":
        return this.isValidChild(parentNode, clipboardNode);
      case "cmdEditPasteReplace":
        return this.isValidChild(parentNode, clipboardNode, selectedNode);
      case "cmdEditPasteFirstChild":
      case "cmdEditPasteLastChild":
        return this.isValidChild(selectedNode, clipboardNode);
      case "cmdEditPasteAsParent":
        return this.isValidChild(clipboardNode, selectedNode) &&
               this.isValidChild(parentNode, clipboardNode, selectedNode);
      case "cmdEditInsertAfter":
      	return parentNode instanceof nsIDOMElement;
      case "cmdEditInsertBefore":
      	return parentNode instanceof nsIDOMElement;
      case "cmdEditInsertFirstChild":
      	return selectedNode instanceof nsIDOMElement;
      case "cmdEditInsertLastChild":
      	return selectedNode instanceof nsIDOMElement;
      case "cmdEditCut":
      case "cmdEditCopy":
      case "cmdEditDelete":
        return this.selectedNode != null;
    }
    return false;
  },

 /**
  * Determines whether the passed parent/child combination is valid.
  * @param parent
  * @param child
  * @param replaced
  *        the node the child is replacing (optional)
  * @return
  *        whether the passed parent can have the passed child as a child,
  */
  isValidChild: function DVr_IsValidChild(parent, child, replaced)
  {
    // the document (fragment) node must be an only child and can't be
    // replaced
    if (parent == null) {
      return false;
    }
    // the only types that can ever have children
    if (parent.nodeType != nsIDOMNode.ELEMENT_NODE &&
        parent.nodeType != nsIDOMNode.DOCUMENT_NODE &&
        parent.nodeType != nsIDOMNode.DOCUMENT_FRAGMENT_NODE) {

      return false;
    }
    // the only types that can't ever be children
    if (child.nodeType == nsIDOMNode.DOCUMENT_NODE ||
        child.nodeType == nsIDOMNode.DOCUMENT_FRAGMENT_NODE ||
        child.nodeType == nsIDOMNode.ATTRIBUTE_NODE) {

      return false;
    }
    // doctypes can only be the children of documents
    if (child.nodeType == nsIDOMNode.DOCUMENT_TYPE_NODE &&
        parent.nodeType != nsIDOMNode.DOCUMENT_NODE) {

      return false;
    }
    // only elements and fragments can have text, cdata, and entities as
    // children
    if (parent.nodeType != nsIDOMNode.ELEMENT_NODE &&
        parent.nodeType != nsIDOMNode.DOCUMENT_FRAGMENT_NODE &&
        (child.nodeType == nsIDOMNode.TEXT_NODE ||
         child.nodeType == nsIDOMNode.CDATA_NODE ||
         child.nodeType == nsIDOMNode.ENTITY_NODE)) {

      return false;
    }
    // documents can only have one document element or doctype
    if (parent.nodeType == nsIDOMNode.DOCUMENT_NODE &&
        (child.nodeType == nsIDOMNode.ELEMENT_NODE ||
         child.nodeType == nsIDOMNode.DOCUMENT_TYPE_NODE) &&
        (!replaced || child.nodeType != replaced.nodeType)) {

      for (var i = 0; i < parent.childNodes.length; i++) {
        if (parent.childNodes[i].nodeType == child.nodeType) {
          return false;
        }
      }
    }
    return true;
  },

  getCommand: function DVr_GetCommand(aCommand)
  {
    if (aCommand in window) {
      return new window[aCommand]();
    }
    return null;
  },

  ////////////////////////////////////////////////////////////////////////////
  //// Event Dispatching

  addObserver: function DVr_AddObserver(aEvent, aObserver)
  {
    this.mObsMan.addObserver(aEvent, aObserver);
  },

  removeObserver: function DVr_RemoveObserver(aEvent, aObserver)
  {
    this.mObsMan.removeObserver(aEvent, aObserver);
  },

  ////////////////////////////////////////////////////////////////////////////
  //// UI Commands

  showFindDialog: function DVr_ShowFindDialog()
  {
    var win =
      openDialog("chrome://inspector/content/viewers/dom/findDialog.xul",
                 "_blank", "chrome,dependent", this.mFindType, this.mFindDir,
                 this.mFindParams);
  },

  /**
   * Toggles the setting for displaying anonymous content.
   */
  toggleAnonContent: function DVr_ToggleAnonContent()
  {
    var value = PrefUtils.getPref("inspector.dom.showAnon");
    PrefUtils.setPref("inspector.dom.showAnon", !value);
  },

  /**
   * Sets the UI and filters for anonymous content.
   *
   * @param aValue
   *        The value that we should be setting things to.
   */
  setAnonContent: function DVr_SetAnonContent(aValue)
  {
    this.mDOMView.showAnonymousContent = aValue;
    this.mPanel.panelset.setCommandAttribute("cmd:toggleAnon", "checked",
                                             aValue);
  },

  toggleSubDocs: function DVr_ToggleSubDocs()
  {
    var val = !this.mDOMView.showSubDocuments;
    this.mDOMView.showSubDocuments = val;
    this.mPanel.panelset.setCommandAttribute("cmd:toggleSubDocs", "checked",
                                             val);
  },

  /**
   * Toggles the visibility of Processing Instructions.
   */
  toggleProcessingInstructions: function DVr_ToggleProcessingInstructions()
  {
    var value = PrefUtils.getPref("inspector.dom.showProcessingInstructions");
    PrefUtils.setPref("inspector.dom.showProcessingInstructions", !value);
  },

  /**
   * Sets the visibility of Processing Instructions.
   *
   * @param aValue
   *        The visibility of the instructions.
   */
  setProcessingInstructions: function DVr_SetProcessingInstructions(aValue)
  {
    this.mPanel.panelset
      .setCommandAttribute("cmd:toggleProcessingInstructions", "checked",
                           aValue);
    if (aValue) {
      this.mDOMView.whatToShow |= NodeFilter.SHOW_PROCESSING_INSTRUCTION;
    }
    else {
      this.mDOMView.whatToShow &= ~NodeFilter.SHOW_PROCESSING_INSTRUCTION;
    }
  },

  /**
   * Toggle state of 'Show Accessible Nodes' option.
   */
  toggleAccessibleNodes: function DVr_ToggleAccessibleNodes()
  {
    var value = PrefUtils.getPref("inspector.dom.showAccessibleNodes");
    PrefUtils.setPref("inspector.dom.showAccessibleNodes", !value);
  },

  /**
   * Set state of 'Show Accessible Nodes' option.
   *
   * @param aValue
   *        if true then accessible nodes will be shown
   */
  setAccessibleNodes: function DVr_SetAccessibleNodes(aValue)
  {
    if (!(kAccessibleRetrievalClassID in Components.classes)) {
      aValue = false;
    }

    this.mDOMView.showAccessibleNodes = aValue;
    this.mPanel.panelset.setCommandAttribute("cmd:toggleAccessibleNodes",
                                             "checked", aValue);
    this.onItemSelected();
  },

  /**
   * Return state of 'Show Accessible Nodes' option.
   */
  getAccessibleNodes: function DVr_GetAccessibleNodes()
  {
    return this.mDOMView.showAccessibleNodes;
  },

  /**
   * Toggles the value for whitespace nodes.
   */
  toggleWhitespaceNodes: function DVr_ToggleWhitespaceNodes()
  {
    var value = PrefUtils.getPref("inspector.dom.showWhitespaceNodes");
    PrefUtils.setPref("inspector.dom.showWhitespaceNodes", !value);
  },

  /**
   * Sets the UI for displaying whitespace nodes.
   *
   * @param aValue
   *        true if whitespace nodes should be shown
   */
  setWhitespaceNodes: function DVr_SetWhitespaceNodes(aValue)
  {
    this.mPanel.panelset.setCommandAttribute("cmd:toggleWhitespaceNodes",
                                             "checked", aValue);
    this.mDOMView.showWhitespaceNodes = aValue;
  },

  showColumnsDialog: function DVr_ShowColumnsDialog()
  {
    var win =
      openDialog("chrome://inspector/content/viewers/dom/columnsDialog.xul",
                 "_blank", "chrome,dependent", this);
  },

  cmdShowPseudoClasses: function DVr_CmdShowPseudoClasses()
  {
    var idx = this.mDOMTree.currentIndex;
    var node = this.getNodeFromRowIndex(idx);

    if (node) {
      openDialog("chrome://inspector/content/viewers/dom/" +
                   "pseudoClassDialog.xul",
                 "_blank", "chrome", node);
    }
  },

  cmdBlink: function DVr_CmdBlink()
  {
    this.flashElement(this.selectedNode);
  },

  cmdBlinkIsValid: function DVr_CmdBlinkIsValid()
  {
    return this.selectedNode &&
           this.selectedNode.nodeType == nsIDOMNode.ELEMENT_NODE;
  },

  onItemSelected: function DVr_OnItemSelected()
  {
    var idx = this.mDOMTree.currentIndex;
    this.mSelection = this.getNodeFromRowIndex(idx);
    this.mObsMan.dispatchEvent("selectionChange",
                               { selection: this.mSelection } );

    if (this.mSelection) {
      this.flashElement(this.mSelection, true);
    }

    viewer.pane.panelset.updateAllCommands();
  },

  setInitialSelection: function DVr_SetInitialSelection(aObject)
  {
    var fireSelected = this.mDOMTree.currentIndex == 0;

    if (this.mPanel.params) {
      this.selectElementInTree(this.mPanel.params);
    }
    else {
      this.selectElementInTree(aObject, true);
    }

    if (fireSelected) {
      this.onItemSelected();
    }
  },

  onContextCreate: function DVr_OnContextCreate(aPP)
  {
    var mi, cmd;
    for (var i = 0; i < aPP.childNodes.length; ++i) {
      mi = aPP.childNodes[i];
      if (mi.hasAttribute("observes")) {
        cmd = document.getElementById(mi.getAttribute("observes"));
        if (cmd && cmd.hasAttribute("isvalid")) {
          try {
            var isValid = new Function(cmd.getAttribute("isvalid"));
          }
          catch (ex) { /* die quietly on syntax error in handler */ }
          if (!isValid()) {
            mi.setAttribute("hidden", "true");
          }
          else {
            mi.removeAttribute("hidden");
          }
        }
      }
    }
  },

  onCommandPopupShowing: function DVr_OnCommandPopupShowing(aMenuPopup)
  {
    for (var i = 0; i < aMenuPopup.childNodes.length; i++) {
      var commandId = aMenuPopup.childNodes[i].getAttribute("command");
      if (viewer.isCommandEnabled(commandId)) {
        document.getElementById(commandId).setAttribute("disabled", "false");
      }
      else {
        document.getElementById(commandId).setAttribute("disabled", "true");
      }
    }
  },

  cmdInspectBrowserIsValid: function DVr_CmdInspectBrowserIsValid()
  {
    var node = viewer.selectedNode;
    if (!node || node.nodeType != nsIDOMNode.ELEMENT_NODE) {
      return false;
    }

    var n = node.localName.toLowerCase();
    return n == "tabbrowser" || n == "browser" || n == "iframe" ||
           n == "frame" || n == "editor";
  },

  cmdInspectBrowser: function DVr_CmdInspectBrowser()
  {
    var node = this.selectedNode;
    var n = node && node.localName.toLowerCase();
    if (n == "iframe" || n == "frame" ||
        (node.namespaceURI == kXULNSURI && (n == "browser" ||
                                            n == "tabbrowser" ||
                                            n == "editor"))) {
      this.subject = node.contentDocument;
    }
  },

  cmdInspectInNewWindow: function DVr_CmdInspectInNewWindow()
  {
    var node = this.selectedNode;
    if (node) {
      inspectObject(node);
    }
  },

  ////////////////////////////////////////////////////////////////////////////
  //// XML Serialization

  cmdCopySelectedXML: function DVr_CmdCopySelectedXML()
  {
    var node = this.selectedNode;
    if (node) {
      var xml = this.toXML(node);

      var helper = XPCU.getService(kClipboardHelperClassID,
                                   "nsIClipboardHelper");
      helper.copyString(xml);
    }
  },

  toXML: function DVr_ToXML(aNode)
  {
    // we'll use XML serializer, if available
    if (typeof XMLSerializer != "undefined") {
      return (new XMLSerializer()).serializeToString(aNode);
    }
    else {
      return this._toXML(aNode, 0);
    }
  },

  // not the most complete serialization ever conceived, but it'll do for now
  _toXML: function DVr__toXML(aNode, aLevel)
  {
    if (!aNode) {
      return "";
    }

    var s = "";
    var indent = "";
    for (var i = 0; i < aLevel; ++i) {
      indent += "  ";
    }
    var line = indent;

    if (aNode.nodeType == nsIDOMNode.ELEMENT_NODE) {
      line += "<" + aNode.localName;

      var attrIndent = "";
      for (i = 0; i < line.length; ++i) {
        attrIndent += " ";
      }

      for (i = 0; i < aNode.attributes.length; ++i) {
        var a = aNode.attributes[i];
        var attr = " " + a.localName + '="' +
                   InsUtil.unicodeToEntity(a.nodeValue) + '"';
        if (line.length + attr.length > 80) {
          s += line + (i < aNode.attributes.length - 1 ?
                         "\n" + attrIndent :
                         "");
          line = "";
        }

        line += attr;
      }
      s += line;

      if (aNode.childNodes.length == 0) {
        s += "/>\n";
      }
      else {
        s += ">\n";
        for (i = 0; i < aNode.childNodes.length; ++i) {
          s += this._toXML(aNode.childNodes[i], aLevel + 1);
        }
        s += indent + "</" + aNode.localName + ">\n";
      }
    }
    else if (aNode.nodeType == nsIDOMNode.TEXT_NODE) {
      s += InsUtil.unicodeToEntity(aNode.data);
    }
    else if (aNode.nodeType == nsIDOMNode.COMMENT_NODE) {
      s += line + "<!--" + InsUtil.unicodeToEntity(aNode.data) + "-->\n";
    }
    else if (aNode.nodeType == nsIDOMNode.DOCUMENT_NODE) {
      s += this._toXML(aNode.documentElement);
    }

    return s;
  },

  ////////////////////////////////////////////////////////////////////////////
  //// Click Selection

  selectByClick: function DVr_SelectByClick()
  {
    if (this.mSelecting) {
      this.stopSelectByClick();
      this.removeClickListeners();
    }
    else {
      // wait until after user releases the mouse after selecting this command
      // from a UI element
      window.setTimeout("viewer.startSelectByClick()", 10);
    }
  },

  startSelectByClick: function DVr_StartSelectByClick()
  {
    this.mSelecting = true;
    this.mSelectDocs = this.getAllDocuments();

    for (var i = 0; i < this.mSelectDocs.length; ++i) {
      var doc = this.mSelectDocs[i];
      doc.addEventListener("mousedown", MouseDownListener, true);
      doc.addEventListener("mouseup", EventCanceller, true);
      doc.addEventListener("click", ListenerRemover, true);
      // If user moves the mouse out of the original target area, there
      // will be no onclick event fired.... so we have to deal with
      // that.
      doc.addEventListener("mouseout", ListenerRemover, true);
    }
    this.mPanel.panelset.setCommandAttribute("cmd:selectByClick", "checked",
                                             "true");
  },

  doSelectByClick: function DVr_DoSelectByClick(aTarget)
  {
    if (aTarget.nodeType == nsIDOMNode.TEXT_NODE) {
      aTarget = aTarget.parentNode;
    }

    this.stopSelectByClick();
    this.selectElementInTree(aTarget);
  },

  stopSelectByClick: function DVr_StopSelectByClick()
  {
    this.mSelecting = false;

    this.mPanel.panelset.setCommandAttribute("cmd:selectByClick", "checked",
                                             null);
  },

  removeClickListeners: function DVr_RemoveClickListeners()
  {
    if (!this.mSelectDocs) { // we didn't select an element by click
      return;
    }

    for (var i = 0; i < this.mSelectDocs.length; ++i) {
      var doc = this.mSelectDocs[i];
      doc.removeEventListener("mousedown", MouseDownListener, true);
      doc.removeEventListener("mouseup", EventCanceller, true);
      doc.removeEventListener("click", ListenerRemover, true);
      doc.removeEventListener("mouseout", ListenerRemover, true);
    }
  },

  ////////////////////////////////////////////////////////////////////////////
  //// Find Methods

  startFind: function DVr_StartFind(aType, aDir)
  {
    this.mFindResult = null;
    this.mFindType = aType;
    this.mFindDir = aDir;
    this.mFindParams = [];
    for (var i = 2; i < arguments.length; ++i) {
      this.mFindParams[i-2] = arguments[i];
    }

    var fn = null;
    switch (aType) {
      case "id":
        fn = "doFindElementById";
        break;
      case "tag":
        fn = "doFindElementsByTagName";
        break;
      case "attr":
        fn = "doFindElementsByAttr";
        break;
    };

    this.mFindFn = fn;
    this.mFindWalker = this.createDOMWalker(this.mDOMView.rootNode);
    this.findNext();
  },

  findNext: function DVr_FindNext()
  {
    var walker = this.mFindWalker;
    if (!walker) {
      Components.utils.reportError("deep tree walker unavailable");
      return;
    }
    var result = null;
    var currentNode = walker.currentNode;
    while (currentNode) {
      if (this[this.mFindFn](walker)) {
        result = walker.currentNode;
        walker.nextNode();
        break;
      }
      currentNode = walker.nextNode();
    }

    if (result && result != this.mFindResult) {
      this.selectElementInTree(result);
      this.mFindResult = result;
      this.mDOMTree.focus();
    }
    else {
      var bundle = this.mPanel.panelset.stringBundle;
      var msg = bundle.getString("findNodesDocumentEnd.message");
      var title = bundle.getString("findNodesDocumentEnd.title");

      var promptService = XPCU.getService(kPromptServiceClassID,
                                         "nsIPromptService");
      promptService.alert(window, title, msg);
    }
  },

  doFindElementById: function DVr_DoFindElementById(aWalker)
  {
    var re = new RegExp(this.mFindParams[0], "i");

    var node = aWalker.currentNode;
    if (!node) {
      return false;
    }

    if (node.nodeType != Components.interfaces.nsIDOMNode.ELEMENT_NODE) {
      return false;
    }

    for (var i = 0; i < node.attributes.length; i++) {
      var attr = node.attributes[i];
      if (attr.isId && re.test(attr.nodeValue)) {
        return true;
      }
    }

    return false;
  },

  doFindElementsByTagName: function DVr_DoFindElementsByTagName(aWalker)
  {
    var re = new RegExp(this.mFindParams[0], "i");

    return aWalker.currentNode &&
           aWalker.currentNode.nodeType == nsIDOMNode.ELEMENT_NODE &&
           re.test(aWalker.currentNode.localName);
  },

  doFindElementsByAttr: function DVr_DoFindElementsByAttr(aWalker)
  {
    var re = new RegExp(this.mFindParams[1], "i");

    return aWalker.currentNode &&
           aWalker.currentNode.nodeType == nsIDOMNode.ELEMENT_NODE &&
           (this.mFindParams[1] == "" ?
             aWalker.currentNode.hasAttribute(this.mFindParams[0]) :
             re.test(aWalker.currentNode.getAttribute(this.mFindParams[0])));
  },

  /**
   * Takes an element from the document being inspected, finds the treeitem
   * which represents it in the DOM tree and selects that treeitem.
   *
   * @param aEl
   *        element from the document being inspected
   */
  selectElementInTree: function DVr_SelectElementInTree(aEl, aExpand, aQuickie)
  {
    var bx = this.mDOMTree.treeBoxObject;

    if (!aEl) {
      bx.view.selection.select(null);
      return false;
    }

    // Keep searching until a pre-created ancestor is
    // found, and then open each ancestor until
    // the found element is created
    var domutils = XPCU.getService(kDOMUtilsClassID, "inIDOMUtils");
    var line = [];
    var parent = aEl;
    var index = null;
    while (parent) {
      index = this.getRowIndexFromNode(parent);
      line.push(parent);
      if (index < 0) {
        // row for this node hasn't been created yet
        parent = domutils.getParentForNode(parent,
                                           this.mDOMView.showAnonymousContent);
      }
      else {
        break;
      }
    }

    // we've got all the ancestors, now open them
    // one-by-one from the top on down
    var view = bx.view;
    var lastIndex;
    for (var i = line.length-1; i >= 0; i--) {
      index = this.getRowIndexFromNode(line[i]);
      if (index < 0)  {
        break; // can't find row, so stop trying to descend
      }
      if ((aExpand || i > 0) && !view.isContainerOpen(index)) {
        view.toggleOpenState(index);
      }
      lastIndex = index;
    }

    if (!aQuickie && lastIndex >= 0) {
      view.selection.select(lastIndex);
      bx.ensureRowIsVisible(lastIndex);
    }

    return aQuickie;
  },

  /**
   * Remember which rows are open and which row is selected. Then rebuild the
   * tree, re-open previously opened rows, and re-select previously selected
   * row.
   */
  rebuild: function DVr_Rebuild()
  {
    var selNode = this.getNodeFromRowIndex(this.mDOMTree.currentIndex);
    this.mDOMTree.view.selection.select(null);

    var opened = [];
    var i;
    for (i = 0; i < this.mDOMView.rowCount; ++i) {
      if (this.mDOMView.isContainerOpen(i)) {
        opened.push(this.getNodeFromRowIndex(i));
      }
    }

    this.mDOMView.rebuild();

    for (i = 0; i < opened.length; ++i) {
      this.selectElementInTree(opened[i], true, true);
    }

    this.selectElementInTree(selNode);
  },

  createDOMWalker: function DVr_CreateDOMWalker(aRoot)
  {
    var walker = XPCU.createInstance(kDeepTreeWalkerClassID,
                                     "inIDeepTreeWalker");
    walker.showAnonymousContent = this.mDOMView.showAnonymousContent;
    walker.showSubDocuments = this.mDOMView.showSubDocuments;
    walker.init(aRoot, Components.interfaces.nsIDOMNodeFilter.SHOW_ALL);
    return walker;
  },

  ////////////////////////////////////////////////////////////////////////////
  //// Columns

  // XXX re-implement custom columns code someday

  initColumns: function DVr_InitColumns()
  {
    var colPref = PrefUtils.getPref("inspector.dom.columns");
    var cols = colPref.split(",")
    this.mColumns = cols;
    this.mColumnHash = {};
  },

  saveColumns: function DVr_SaveColumns()
  {
    var cols = this.mColumns.join(",");
    PrefUtils.setPref("inspector.dom.columns", cols);
  },

  ////////////////////////////////////////////////////////////////////////////
  //// Flashing

  flashElement: function DVr_FlashElement(aElement, aIsOnSelect)
  {
    // make sure we only try to flash element nodes, and don't
    // flash the documentElement (it's too darn big!)
    if (aElement.nodeType == nsIDOMNode.ELEMENT_NODE &&
        aElement != aElement.ownerDocument.documentElement) {

      var flasher = this.mPanel.panelset.flasher;
      if (aIsOnSelect) {
        flasher.flashElementOnSelect(aElement);
      }
      else {
        flasher.flashElement(aElement);
      }
    }
  },

  ////////////////////////////////////////////////////////////////////////////
  //// Prefs

  /**
   * Called by PrefChangeObserver.
   *
   * @param aName
   *        The name of the preference that has been changed.
   */
  onPrefChanged: function DVr_OnPrefChanged(aName)
  {
    var value = PrefUtils.getPref(aName);

    switch (aName) {
      case "inspector.dom.showAnon":
        this.setAnonContent(value);
        break;

      case "inspector.dom.showProcessingInstructions":
        this.setProcessingInstructions(value);
        break;

      case "inspector.dom.showAccessibleNodes":
        this.setAccessibleNodes(value);
        break;

      case "inspector.dom.showWhitespaceNodes":
        this.setWhitespaceNodes(value);
        break;

      default:
        return;
    }

    this.rebuild();
  },

  ////////////////////////////////////////////////////////////////////////////
  //// Uncategorized

  getAllDocuments: function DVr_GetAllDocuments()
  {
    var doc = this.mDOMView.rootNode;
    var results = [doc];
    this.findDocuments(doc, results);
    return results;
  },

  findDocuments: function DVr_FindDocuments(aDoc, aArray)
  {
    this.addKidsToArray(aDoc.getElementsByTagName("frame"), aArray);
    this.addKidsToArray(aDoc.getElementsByTagName("iframe"), aArray);
    this.addKidsToArray(aDoc.getElementsByTagNameNS(kXULNSURI, "browser"),
                        aArray);
    this.addKidsToArray(aDoc.getElementsByTagNameNS(kXULNSURI, "tabbrowser"),
                        aArray);
    this.addKidsToArray(aDoc.getElementsByTagNameNS(kXULNSURI, "editor"),
                        aArray);
  },

  addKidsToArray: function DVr_AddKidsToArray(aKids, aArray)
  {
    for (var i = 0; i < aKids.length; ++i) {
      try {
        aArray.push(aKids[i].contentDocument);
        // Now recurse down into the kid and look for documents there
        this.findDocuments(aKids[i].contentDocument, aArray);
      }
      catch (ex) {
        // if we can't access the content document, skip it
      }
    }
  },

  get selectedNode()
  {
    var index = this.mDOMTree.currentIndex;
    return this.getNodeFromRowIndex(index);
  },

  getNodeFromRowIndex: function DVr_GetNodeFromRowIndex(aIndex)
  {
    try {
      return this.mDOMView.getNodeFromRowIndex(aIndex);
    }
    catch (ex) {
      return null;
    }
  },

  getRowIndexFromNode: function DVr_GetRowIndexFromNode(aNode)
  {
    try {
      return this.mDOMView.getRowIndexFromNode(aNode);
    }
    catch (ex) {
      return -1;
    }
  }
};

//////////////////////////////////////////////////////////////////////////////
//// Command Objects

function cmdEditDelete() {}

cmdEditDelete.prototype =
{
  node: null,
  nextSibling: null,
  parentNode: null,

  // remove this line for bug 179621, Phase Three
  txnType: "standard",

  // required for nsITransaction
  QueryInterface: txnQueryInterface,
  merge: txnMerge,
  isTransient: false,
  redoTransaction: txnRedoTransaction,

  doTransaction: function Delete_DoTransaction()
  {
    var node = this.node || viewer.selectedNode;
    if (node) {
      this.node = node;
      this.nextSibling = node.nextSibling;
      this.parentNode = node.parentNode;
      var selectNode = this.nextSibling;
      if (!selectNode) {
        selectNode = node.previousSibling;
      }
      if (!selectNode) {
        selectNode = this.parentNode;
      }
      viewer.selectElementInTree(selectNode);
      node.parentNode.removeChild(node);
    }
  },

  undoTransaction: function Delete_UndoTransaction()
  {
    if (this.node) {
      this.parentNode.insertBefore(this.node, this.nextSibling);
    }
    viewer.selectElementInTree(this.node);
  }
};

function cmdEditCut() {}

cmdEditCut.prototype =
{
  cmdCopy: null,
  cmdDelete: null,

  // remove this line for bug 179621, Phase Three
  txnType: "standard",

  // required for nsITransaction
  QueryInterface: txnQueryInterface,
  merge: txnMerge,
  isTransient: false,
  redoTransaction: txnRedoTransaction,

  doTransaction: function Cut_DoTransaction()
  {
    if (!this.cmdCopy) {
      this.cmdDelete = new cmdEditDelete();
      this.cmdCopy = new cmdEditCopy();
    }
    this.cmdCopy.doTransaction();
    this.cmdDelete.doTransaction();
  },

  undoTransaction: function Cut_UndoTransaction()
  {
    this.cmdDelete.undoTransaction();
  }
};

function cmdEditCopy() {}

cmdEditCopy.prototype =
{
  copiedNode: null,

  // remove this line for bug 179621, Phase Three
  txnType: "standard",

  // required for nsITransaction
  QueryInterface: txnQueryInterface,
  merge: txnMerge,
  isTransient: true,
  redoTransaction: txnRedoTransaction,

  doTransaction: function Copy_DoTransaction()
  {
    var copiedNode = null;
    if (!this.copiedNode) {
      copiedNode = viewer.selectedNode.cloneNode(true);
      if (copiedNode) {
        this.copiedNode = copiedNode;
      }
    }
    else {
      copiedNode = this.copiedNode;
    }

    viewer.pane.panelset.setClipboardData(copiedNode, "inspector/dom-node",
                                          null);
  }
};

/**
 * Pastes the node on the clipboard as the next sibling of the selected node.
 */
function cmdEditPaste() {}

cmdEditPaste.prototype =
{
  pastedNode: null,
  pastedBefore: null,

  // remove this line for bug 179621, Phase Three
  txnType: "standard",

  // required for nsITransaction
  QueryInterface: txnQueryInterface,
  merge: txnMerge,
  isTransient: false,
  redoTransaction: txnRedoTransaction,

  doTransaction: function Paste_DoTransaction()
  {
    var node = this.pastedNode || viewer.pane.panelset.getClipboardData();
    var selected = this.pastedBefore || viewer.selectedNode;
    if (selected) {
      this.pastedNode = node.cloneNode(true);
      this.pastedBefore = selected;
      selected.parentNode.insertBefore(this.pastedNode, selected.nextSibling);
      return false;
    }
    return true;
  },

  undoTransaction: function Paste_UndoTransaction()
  {
    if (this.pastedNode) {
      this.pastedNode.parentNode.removeChild(this.pastedNode);
    }
  }
};

/**
 * Pastes the node on the clipboard as the previous sibling of the selected
 * node.
 */
function cmdEditPasteBefore() {}

cmdEditPasteBefore.prototype =
{
  pastedNode: null,
  pastedBefore: null,

  // remove this line for bug 179621, Phase Three
  txnType: "standard",

  // required for nsITransaction
  QueryInterface: txnQueryInterface,
  merge: txnMerge,
  isTransient: false,
  redoTransaction: txnRedoTransaction,

  doTransaction: function PasteBefore_DoTransaction()
  {
    var node = this.pastedNode || viewer.pane.panelset.getClipboardData();
    var selected = this.pastedBefore || viewer.selectedNode;
    if (selected) {
      this.pastedNode = node.cloneNode(true);
      this.pastedBefore = selected;
      selected.parentNode.insertBefore(this.pastedNode, selected);
      return false;
    }
    return true;
  },

  undoTransaction: function PasteBefore_UndoTransaction()
  {
    if (this.pastedNode) {
      this.pastedNode.parentNode.removeChild(this.pastedNode);
    }
  }
};

/**
 * Pastes the node on the clipboard in the place of the selected node,
 * overwriting it.
 */
function cmdEditPasteReplace() {}

cmdEditPasteReplace.prototype =
{
  pastedNode: null,
  originalNode: null,

  // remove this line for bug 179621, Phase Three
  txnType: "standard",

  // required for nsITransaction
  QueryInterface: txnQueryInterface,
  merge: txnMerge,
  isTransient: false,
  redoTransaction: txnRedoTransaction,

  doTransaction: function PasteReplace_DoTransaction()
  {
    var node = this.pastedNode || viewer.pane.panelset.getClipboardData();
    var selected = this.originalNode || viewer.selectedNode;
    if (selected) {
      this.pastedNode = node.cloneNode(true);
      this.originalNode = selected;
      selected.parentNode.replaceChild(this.pastedNode, selected);
      return false;
    }
    return true;
  },

  undoTransaction: function PasteReplace_UndoTransaction()
  {
    if (this.pastedNode) {
      this.pastedNode.parentNode.replaceChild(this.originalNode,
                                              this.pastedNode);
    }
  }
};

/**
 * Pastes the node on the clipboard as the first child of the selected node.
 */
function cmdEditPasteFirstChild() {}

cmdEditPasteFirstChild.prototype =
{
  pastedNode: null,
  pastedBefore: null,

  // remove this line for bug 179621, Phase Three
  txnType: "standard",

  // required for nsITransaction
  QueryInterface: txnQueryInterface,
  merge: txnMerge,
  isTransient: false,
  redoTransaction: txnRedoTransaction,

  doTransaction: function PasteFirstChild_DoTransaction()
  {
    var node = this.pastedNode || viewer.pane.panelset.getClipboardData();
    var selected = this.pastedBefore || viewer.selectedNode;
    if (selected) {
      this.pastedNode = node.cloneNode(true);
      this.pastedBefore = selected.firstChild;
      selected.insertBefore(this.pastedNode, this.pastedBefore);
      return false;
    }
    return true;
  },

  undoTransaction: function PasteFirstChild_UndoTransaction()
  {
    if (this.pastedNode) {
      this.pastedNode.parentNode.removeChild(this.pastedNode);
    }
  }
};

/**
 * Pastes the node on the clipboard as the last child of the selected node.
 */
function cmdEditPasteLastChild() {}

cmdEditPasteLastChild.prototype =
{
  pastedNode: null,
  selectedNode: null,

  // remove this line for bug 179621, Phase Three
  txnType: "standard",

  // required for nsITransaction
  QueryInterface: txnQueryInterface,
  merge: txnMerge,
  isTransient: false,
  redoTransaction: txnRedoTransaction,

  doTransaction: function PasteLastChild_DoTransaction()
  {
    var node = this.pastedNode || viewer.pane.panelset.getClipboardData();
    var selected = this.selectedNode || viewer.selectedNode;
    if (selected) {
      this.pastedNode = node.cloneNode(true);
      this.selectedNode = selected;
      selected.appendChild(this.pastedNode);
      return false;
    }
    return true;
  },

  undoTransaction: function PasteLastChild_UndoTransaction()
  {
    if (this.selectedNode) {
      this.selectedNode.removeChild(this.pastedNode);
    }
  }
};

/**
 * Pastes the node on the clipboard in the place of the selected node, making
 * the selected node its child.
 */
function cmdEditPasteAsParent() {}

cmdEditPasteAsParent.prototype =
{
  pastedNode: null,
  originalNode: null,
  originalParentNode: null,

  // remove this line for bug 179621, Phase Three
  txnType: "standard",

  // required for nsITransaction
  QueryInterface: txnQueryInterface,
  merge: txnMerge,
  isTransient: false,
  redoTransaction: txnRedoTransaction,

  doTransaction: function PasteAsParent_DoTransaction()
  {
    var node = this.pastedNode || viewer.pane.panelset.getClipboardData();
    var selected = this.originalNode || viewer.selectedNode;
    var parent = this.originalParentNode || selected.parentNode;
    if (selected) {
      this.pastedNode = node.cloneNode(true);
      this.originalNode = selected;
      this.originalParentNode = parent;
      parent.replaceChild(this.pastedNode, selected);
      this.pastedNode.appendChild(selected);
      return false;
    }
    return true;
  },

  undoTransaction: function PasteAsParent_UndoTransaction()
  {
    if (this.pastedNode) {
      this.originalParentNode.replaceChild(this.originalNode,
                                           this.pastedNode);
    }
  }
};

/**
 * Generic prototype for inserting a new node somewhere
 */
function InsertNode() {}

InsertNode.prototype =
{
  insertedNode: null,
  originalNode: null,
  attr: null,

  // remove this line for bug 179621, Phase Three
  txnType: "standard",

  // required for nsITransaction
  QueryInterface: txnQueryInterface,
  merge: txnMerge,
  isTransient: false,
  redoTransaction: txnRedoTransaction,

  insertNode: function Insert_InsertNode()
  {
  },

  createNode: function Insert_CreateNode()
  {
    var doc = this.originalNode.ownerDocument;
    if (!this.attr) {
      this.attr = { type: null, value: null, namespaceURI: null,
                    accepted: false,
                    enableNamespaces: doc.contentType != "text/html" };

      window.openDialog("chrome://inspector/content/viewers/dom/" +
                          "insertDialog.xul",
                        "insert", "chrome,modal,centerscreen", doc,
                        this.attr);
    }

    if (this.attr.accepted) {
      switch (this.attr.type) {
        case nsIDOMNode.ELEMENT_NODE:
          if (this.attr.enableNamespaces) {
            this.insertedNode = doc.createElementNS(this.attr.namespaceURI,
                                                    this.attr.value);
          }
          else {
            this.insertedNode = doc.createElement(this.attr.value);
          }
          break;
        case nsIDOMNode.TEXT_NODE:
          this.insertedNode = doc.createTextNode(this.attr.value);
          break;
      }
      return true;
    }
    return false;
  },

  doTransaction: function Insert_DoTransaction()
  {
    var selected = this.originalNode || viewer.selectedNode;
    if (selected) {
      this.originalNode = selected;
      if (this.createNode()) {
        this.insertNode();
        return false;
      }
    }
    return true;
  },

  undoTransaction: function Insert_UndoTransaction()
  {
    if (this.insertedNode) {
      this.insertedNode.parentNode.removeChild(this.insertedNode);
    }
  }
};

/**
 * Inserts a node after the selected node.
 */
function cmdEditInsertAfter() {}

cmdEditInsertAfter.prototype = new InsertNode();

cmdEditInsertAfter.prototype.insertNode = function InsertAfter_InsertNode()
{
  this.originalNode.parentNode.insertBefore(this.insertedNode,
                                            this.originalNode.nextSibling);
};

/**
 * Inserts a node before the selected node.
 */
function cmdEditInsertBefore() {}

cmdEditInsertBefore.prototype = new InsertNode();

cmdEditInsertBefore.prototype.insertNode = function InsertBefore_InsertNode()
{
  this.originalNode.parentNode.insertBefore(this.insertedNode,
                                            this.originalNode);
};

/**
 * Inserts a node as the first child of the selected node.
 */
function cmdEditInsertFirstChild() {}

cmdEditInsertFirstChild.prototype = new InsertNode();

cmdEditInsertFirstChild.prototype.insertNode =
  function InsertFirstChild_InsertNode()
{
  this.originalNode.insertBefore(this.insertedNode,
                                 this.originalNode.firstChild);
};

/**
 * Inserts a node as the last child of the selected node.
 */
function cmdEditInsertLastChild() {}

cmdEditInsertLastChild.prototype = new InsertNode();

cmdEditInsertLastChild.prototype.insertNode =
  function InsertLastChild_InsertNode()
{
  this.originalNode.appendChild(this.insertedNode);
};


//////////////////////////////////////////////////////////////////////////////
//// Listener Objects

var MouseDownListener = {
  handleEvent: function MDL_HandleEvent(aEvent)
  {
    aEvent.stopPropagation();
    aEvent.preventDefault();

    var target = viewer.mDOMView.showAnonymousContent ?
                                   aEvent.originalTarget :
                                   aEvent.target;
    viewer.doSelectByClick(target);
  }
};

var EventCanceller = {
  handleEvent: function EC_HandleEvent(aEvent)
  {
    aEvent.stopPropagation();
    aEvent.preventDefault();
  }
};

var ListenerRemover = {
  handleEvent: function LR_HandleEvent(aEvent)
  {
    if (!viewer.mSelecting) {
      if (aEvent.type == "click") {
        aEvent.stopPropagation();
        aEvent.preventDefault();
      }
      viewer.removeClickListeners();
    }
  }
};

var PrefChangeObserver = {
  observe: function PCO_Observe(aSubject, aTopic, aData)
  {
    viewer.onPrefChanged(aData);
  }
};

function gColumnAddListener(aIndex)
{
  viewer.onColumnAdd(aIndex);
}

function gColumnRemoveListener(aIndex)
{
  viewer.onColumnRemove(aIndex);
}

function dumpDOM2(aNode)
{
  dump(DOMViewer.prototype.toXML(aNode));
}
