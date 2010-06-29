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
* StyleRulesViewer --------------------------------------------
*  The viewer for CSS style rules that apply to a DOM element.
* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
* REQUIRED IMPORTS:
*   chrome://inspector/content/utils.js
*   chrome://inspector/content/jsutil/xpcom/XPCU.js
*   chrome://inspector/content/jsutil/rdf/RDFU.js
*   chrome://global/content/viewSourceUtils.js
****************************************************************/

//////////// global variables /////////////////////

var viewer;
var gPromptService;

//////////// global constants ////////////////////

const kDOMUtilsCID = "@mozilla.org/inspector/dom-utils;1";
const kPromptServiceCID = "@mozilla.org/embedcomp/prompt-service;1";
const kClipboardHelperCID = "@mozilla.org/widget/clipboardhelper;1";

/////////////////////////////////////////////////

window.addEventListener("load", StyleRulesViewer_initialize, false);

function StyleRulesViewer_initialize()
{
  viewer = new StyleRulesViewer();
  viewer.initialize(parent.FrameExchange.receiveData(window));

  gPromptService = XPCU.getService(kPromptServiceCID, "nsIPromptService");
}

////////////////////////////////////////////////////////////////////////////
//// class StyleRulesViewer

function StyleRulesViewer() // implements inIViewer
{
  this.mObsMan = new ObserverManager();

  this.mURL = window.location;
  this.mRuleTree = document.getElementById("olStyleRules");
  this.mRuleBoxObject = this.mRuleTree.treeBoxObject;
  this.mPropsTree = document.getElementById("olStyleProps");
  this.mPropsBoxObject = this.mPropsTree.treeBoxObject;
  this.mFocusedTree = null;
}

StyleRulesViewer.prototype =
{

  ////////////////////////////////////////////////////////////////////////////
  //// Initialization

  mSubject: null,
  mPanel: null,

  ////////////////////////////////////////////////////////////////////////////
  //// interface inIViewer

  get uid() { return "styleRules" },
  get pane() { return this.mPanel },

  get selection() { return null },

  get subject() { return this.mSubject },
  set subject(aObject)
  {
    this.mSubject = aObject;
    // update the rule tree
    this.mRuleView = new StyleRuleView(aObject);
    this.mRuleBoxObject.view = this.mRuleView;
    // clear the props tree
    this.mPropsTree.disabled = true;
    this.mPropsTree.contextMenu = null;
    this.mPropsView = null;
    this.mPropsBoxObject.view = null;

    this.mObsMan.dispatchEvent("subjectChange", { subject: aObject });
  },

  initialize: function SRVr_Initialize(aPane)
  {
    this.mPanel = aPane;
    aPane.notifyViewerReady(this);
  },

  destroy: function SRVr_Destroy()
  {
    // We need to remove the views at this time or else they will attempt to
    // re-paint while the document is being deconstructed, resulting in
    // some nasty XPConnect assertions
    this.mRuleBoxObject.view = null;
    this.mPropsBoxObject.view = null;
  },

  isCommandEnabled: function SRVr_IsCommandEnabled(aCommand)
  {
    var rule = this.getSelectedRule();
    var fileURI = rule && rule.parentStyleSheet && rule.parentStyleSheet.href;
    // XXX can't edit resource: stylesheets because of bug 343508, and
    // CSSFontFaceRules because of bug 443978
    var isEditable = !(/^resource:/.test(fileURI) ||
                       rule instanceof CSSFontFaceRule);

    var propFocus = this.mFocusedTree == this.mPropsTree;
    var propCount = this.mPropsTree.view.selection.count;

    switch (aCommand) {
      // ppStylePropsContext
      // The first three of these are context-sensitive; until they are
      // supported for the rule pane, they are meaningless when it has focus.
      case "cmdEditCopy":
        return propFocus && propCount > 0;
      case "cmdEditDelete":
        return isEditable && propFocus && propCount > 0;
      case "cmdEditInsert":
        return isEditable && propFocus;
      case "cmdTogglePriority":
        return isEditable && propCount > 0;
      case "cmdEditEdit":
        return isEditable && propCount == 1;
      // ppStyleRulesContext
      case "cmdCopySelectedFileURI":
      case "cmdViewSelectedFileURI":
        return fileURI;
    }
    return false;
  },

  getCommand: function SRVr_GetCommand(aCommand)
  {
    switch (aCommand) {
      case "cmdEditCopy":
        return new cmdEditCopy(this.mPropsView.getSelectedRowObjects());
      case "cmdEditDelete":
        return new cmdEditDelete(this.getSelectedDec(),
                                 this.mPropsView.getSelectedRowObjects());
      case "cmdEditInsert":
        var bundle = this.mPanel.panelset.stringBundle;
        var msg = bundle.getString("styleRulePropertyName.message");
        var title = bundle.getString("styleRuleNewProperty.title");

        var property = { value: "" };
        var value = { value: "" };
        var dummy = { value: false };

        if (!gPromptService.prompt(window, title, msg, property, null, dummy)) {
          return null;
        }

        msg = bundle.getString("styleRulePropertyValue.message");
        if (!gPromptService.prompt(window, title, msg, value, null, dummy)) {
          return null;
        }

        return new cmdEditInsert(this.getSelectedDec(), property.value,
                                  value.value, "");
      case "cmdEditEdit":
        var rule = this.getSelectedDec();
        var property = this.getSelectedProp();
        var priority = rule.getPropertyPriority(property);

        var bundle = this.mPanel.panelset.stringBundle;
        var msg = bundle.getString("styleRulePropertyValue.message");
        var title = bundle.getString("styleRuleEditProperty.title");

        var value = { value: rule.getPropertyValue(property) };
        var dummy = { value: false };

        if (!gPromptService.prompt(window, title, msg, value, null, dummy)) {
          return null;
        }

        return new cmdEditEdit(rule, property, value.value, priority);
      case "cmdTogglePriority":
        return new cmdTogglePriority(this.getSelectedDec(),
                                     this.mPropsView.getSelectedRowObjects());
    }
    return null;
  },

  ////////////////////////////////////////////////////////////////////////////
  //// event dispatching

  addObserver: function SRVr_AddObserver(aEvent, aObserver)
  {
    this.mObsMan.addObserver(aEvent, aObserver);
  },

  removeObserver: function SRVr_RemoveObserver(aEvent, aObserver)
  {
    this.mObsMan.removeObserver(aEvent, aObserver);
  },

  ////////////////////////////////////////////////////////////////////////////
  //// UI Commands

  //////// rule contextual commands

  cmdCopySelectedFileURI: function SRVr_CmdCopySelectedFileURI()
  {
    var rule = this.getSelectedRule();
    if (!rule || !rule.parentStyleSheet || !rule.parentStyleSheet.href)
      return;
    var selectedURI = rule.parentStyleSheet.href;
    var helper = XPCU.getService(kClipboardHelperCID, "nsIClipboardHelper");

    helper.copyString(selectedURI);
  },

  cmdViewSelectedFileURI: function SRVr_CmdViewSelectedFileURI()
  {
    var rule = this.getSelectedRule();
    if (!rule || !rule.parentStyleSheet || !rule.parentStyleSheet.href)
      return;
    var selectedURI = rule.parentStyleSheet.href;
    var lineNumber =  rule.type == CSSRule.STYLE_RULE ?
                        this.mRuleView.mDOMUtils.getRuleLine(rule) : null;

    // 1.9.0 toolkit doesn't have this method
    if ("viewSource" in gViewSourceUtils)
      gViewSourceUtils.viewSource(selectedURI, null, null, lineNumber);
    else
      openDialog("chrome://global/content/viewSource.xul",
                 "_blank",
                 "all,dialog=no",
                 selectedURI, null, null, lineNumber, null);
  },

  ////////////////////////////////////////////////////////////////////////////
  //// Uncategorized

  getSelectedDec: function SRVr_GetSelectedDec()
  {
    var idx = this.mRuleTree.currentIndex;
    return this.mRuleView.selection.count == 1 ?
             this.mRuleView.getDecAt(idx) :
             null;
  },

  getSelectedProp: function SRVr_GetSelectedProp()
  {
    if (this.mPropsView.selection.count != 1)
      return null;
    var dec = this.getSelectedDec();
    // API awkwardness
    var min = {}, max = {};
    this.mPropsView.selection.getRangeAt(0, min, max);
    return dec.item(min.value);
  },

  getSelectedRule: function SRVr_GetSelectedRule()
  {
    var idx = this.mRuleTree.currentIndex;
    return this.mRuleView.selection.count == 1 ?
             this.mRuleView.getRuleAt(idx) :
             null;
  },

  onRuleSelect: function SRVr_OnRuleSelect()
  {
    var dec = this.getSelectedDec();
    this.mPropsView = new StylePropsView(dec);
    this.mPropsBoxObject.view = this.mPropsView;
    viewer.pane.panelset.updateAllCommands();
    // for non-style rules, change props tree depending on its relevance
    this.mPropsTree.disabled = !dec;
    this.mPropsTree.contextMenu = dec ? "ppStylePropsContext" : null;
  },

  onPropSelect: function SRVr_OnPropSelect()
  {
    viewer.pane.panelset.updateAllCommands();
  },

  onTreeFocus: function SRVr_OnTreeFocus(aTree)
  {
    this.mFocusedTree = aTree;
    viewer.pane.panelset.updateAllCommands();
  },

  onPopupShowing: function SRVr_OnPopupShowing(aCommandSetId)
  {
    var commandset = document.getElementById(aCommandSetId);
    for (var i = 0; i < commandset.childNodes.length; i++) {
      var command = commandset.childNodes[i];
      command.setAttribute("disabled", !viewer.isCommandEnabled(command.id));
    }
  }
};

////////////////////////////////////////////////////////////////////////////
//// StyleRuleView

function StyleRuleView(aObject)
{
  this.mDOMUtils = XPCU.getService(kDOMUtilsCID, "inIDOMUtils");
  this.mLevel = [];
  this.mOpen = [];
  if (aObject instanceof Components.interfaces.nsIDOMCSSStyleSheet) {
    document.getElementById("olcRule").setAttribute("primary", "true");
    this.mSheetRules = [];
    for (let i = 0; i < aObject.cssRules.length; i++) {
      this.mSheetRules[i] = aObject.cssRules[i];
      this.mLevel[i] = 0;
      this.mOpen[i] = false;
    }
  }
  else {
    document.getElementById("olcRule").removeAttribute("primary");
    this.mRules = this.mDOMUtils.getCSSStyleRules(aObject);
    if (aObject.hasAttribute("style")) {
      try {
        this.mStyleAttribute =
          new XPCNativeWrapper(aObject, "style").style;
      }
      catch (ex) {
      }
    }
  }
}

StyleRuleView.prototype = new inBaseTreeView();

StyleRuleView.prototype.mSheetRules = null;
StyleRuleView.prototype.mLevel = null;
StyleRuleView.prototype.mOpen = null;
StyleRuleView.prototype.mRules = null;
StyleRuleView.prototype.mStyleAttribute = null;

StyleRuleView.prototype.getRuleAt =
function SRV_GetRuleAt(aRow)
{
  if (aRow >= 0) {
    if (this.mRules) {
      var rule = this.mRules.GetElementAt(aRow);
      try {
        return XPCU.QI(rule, "nsIDOMCSSStyleRule");
      }
      catch (ex) {
      }
    }
    else {
      return this.mSheetRules[aRow];
    }
  }
  return null;
}

StyleRuleView.prototype.getDecAt =
function SRV_GetDecAt(aRow)
{
  if (aRow >= 0) {
    if (this.mRules) {
      if (this.mStyleAttribute && aRow == this.mRules.Count()) {
        return this.mStyleAttribute;
      }
      var rule = this.mRules.GetElementAt(aRow);
      try {
        return XPCU.QI(rule, "nsIDOMCSSStyleRule").style;
      }
      catch (ex) {
      }
    }
    // for CSSStyleRule, CSSFontFaceRule, CSSPageRule, and ElementCSSInlineStyle
    else if ("style" in this.mSheetRules[aRow]) {
      return this.mSheetRules[aRow].style;
    }
  }
  return null;
}

StyleRuleView.prototype.getChildCount = function SRV_GetChildCount(aRow)
{
  if (aRow >= 0) {
    var rule = this.mSheetRules[aRow];
    if (rule instanceof CSSImportRule)
      return rule.styleSheet ? rule.styleSheet.cssRules.length : 0;
    if (rule instanceof CSSMediaRule ||
        rule instanceof CSSMozDocumentRule)
      return rule.cssRules.length;
  }
  return 0;
}

///////////////////////////////////////////////////////////////////////////////
//// interface nsITreeView (override inBaseTreeView)

StyleRuleView.prototype.__defineGetter__("rowCount",
function()
{
  if (this.mRules)
    return this.mRules.Count() + (this.mStyleAttribute ? 1 : 0);
  if (this.mSheetRules)
    return this.mSheetRules.length;
  return 0;
});

StyleRuleView.prototype.getCellText =
function SRV_GetCellText(aRow, aCol)
{
  if (aRow > this.rowCount) return "";

  // special case for the style attribute
  if (this.mStyleAttribute && aRow == this.mRules.Count()) {
    if (aCol.id == "olcRule") {
      return 'style=""';
    }

    if (aCol.id == "olcFileURL") {
      // we ought to be able to get to the URL...
      return "";
    }

    if (aCol.id == "olcLine") {
      return "";
    }
    return "";
  }

  var rule = this.getRuleAt(aRow);
  if (!rule) return "";

  if (aCol.id == "olcRule") {
    if (rule instanceof CSSStyleRule) {
      return rule.selectorText;
    }
    if (rule instanceof CSSFontFaceRule) {
      return "@font-face";
    }
    if (rule instanceof CSSMediaRule ||
        rule instanceof CSSMozDocumentRule) {
      // get rule text up until the block begins, and trim off whitespace
      return rule.cssText.replace(/\s*{[\s\S]*/, "");
    }
    return rule.cssText;
  }

  if (aCol.id == "olcFileURL") {
    return rule.parentStyleSheet ? rule.parentStyleSheet.href : "";
  }

  if (aCol.id == "olcLine") {
    return rule.type == CSSRule.STYLE_RULE ?
                          this.mDOMUtils.getRuleLine(rule) :
                          "";
  }

  return "";
}

StyleRuleView.prototype.getLevel = function SRV_GetLevel(aRow)
{
  if (aRow in this.mLevel)
    return this.mLevel[aRow];
  return 0;
}

StyleRuleView.prototype.getParentIndex = function SRV_GetParentIndex(aRow)
{
  var level = this.getLevel(aRow);
  for (var i = aRow - 1; i >= 0; --i) {
    if (this.getLevel(i) < level)
      return i;
  }
  return -1;
}

StyleRuleView.prototype.hasNextSibling =
function SRV_HasNextSibling(aRow, aAfter)
{
  var baseLevel = this.getLevel(aRow);
  var rowCount = this.rowCount; // quick access since this property is dynamic
  for (var i = aAfter + 1; i < rowCount; ++i) {
    if (this.getLevel(i) < baseLevel)
      break;
    if (this.getLevel(i) == baseLevel)
      return true;
  }
  return false;
}

StyleRuleView.prototype.isContainer = function SRV_IsContainer(aRow)
{
  if (this.mSheetRules) {
    if (this.mSheetRules[aRow] instanceof CSSImportRule ||
        this.mSheetRules[aRow] instanceof CSSMediaRule ||
        this.mSheetRules[aRow] instanceof CSSMozDocumentRule) {
      return true;
    }
  }
  return false;
}

StyleRuleView.prototype.isContainerEmpty = function SRV_IsContainerEmpty(aRow)
{
  return !this.getChildCount(aRow);
}

StyleRuleView.prototype.isContainerOpen = function SRV_IsContainerOpen(aRow)
{
  return this.mOpen[aRow];
}

StyleRuleView.prototype.toggleOpenState = function SRV_ToggleOpenState(aRow)
{
  var oldLength = this.mSheetRules.length;
  var childLevel = this.mLevel[aRow] + 1;
  if (this.mOpen[aRow]) {
    // find the number of children and other descendants
    for (var i = aRow + 1; i < this.mSheetRules.length; ++i) {
      if (this.mLevel[i] < childLevel)
        break;
    }
    var count = i - aRow - 1;
    this.mSheetRules.splice(aRow + 1, count);
    this.mLevel.splice(aRow + 1, count);
    this.mOpen.splice(aRow + 1, count);
  }
  else {
    var inserts = [];
    var rule = this.mSheetRules[aRow];
    if (rule instanceof CSSImportRule) {
      // @import is tricky, because its styleSheet property is allowed to be
      // null if its media-type qualifier isn't supported, among other reasons.
      inserts = rule.styleSheet ? rule.styleSheet.cssRules : [];
    }
    else if (rule instanceof CSSMediaRule ||
             rule instanceof CSSMozDocumentRule) {
      inserts = rule.cssRules;
    }
    // make space for children
    var count = this.getChildCount(aRow);
    for (var i = this.rowCount - 1; i > aRow; --i) {
      this.mSheetRules[i + count] = this.mSheetRules[i];
      this.mLevel[i + count] = this.mLevel[i];
      this.mOpen[i + count] = this.mOpen[i];
    }
    // fill in children
    for (var i = 0; i < inserts.length; ++i) {
      this.mSheetRules[aRow + 1 + i] = inserts[i];
      this.mLevel[aRow + 1 + i] = childLevel;
      this.mOpen[aRow + 1 + i] = false;
    }
  }
  this.mOpen[aRow] = !this.mOpen[aRow];
  viewer.mRuleTree.treeBoxObject.rowCountChanged(aRow + 1,
    this.mSheetRules.length - oldLength);
  viewer.mRuleTree.treeBoxObject.invalidateRow(aRow);
}

////////////////////////////////////////////////////////////////////////////
//// StylePropsView

function StylePropsView(aDec)
{
  this.mDec = aDec;
}

StylePropsView.prototype = new inBaseTreeView();

StylePropsView.prototype.__defineGetter__("rowCount",
function()
{
  return this.mDec ? this.mDec.length : 0;
});

StylePropsView.prototype.getCellProperties =
function SPV_GetCellProperties(aRow, aCol, aProperties)
{
  if (aCol.id == "olcPropPriority") {
    var prop = this.mDec.item(aRow);
    if (this.mDec.getPropertyPriority(prop) == "important") {
      aProperties.AppendElement(this.createAtom("important"));
    }
  }
}

StylePropsView.prototype.getCellText =
function SPV_GetCellText(aRow, aCol)
{
  var prop = this.mDec.item(aRow);

  if (aCol.id == "olcPropName") {
    return prop;
  }
  else if (aCol.id == "olcPropValue") {
    return this.mDec.getPropertyValue(prop)
  }

  return null;
}

/**
 * Returns a CSSDeclaration for the row in the tree corresponding to the
 * passed index.
 * @param aIndex index of the row in the tree
 * @return a CSSDeclaration
 */
StylePropsView.prototype.getRowObjectFromIndex =
function SPV_GetRowObjectFromIndex(aIndex)
{
  var prop = this.mDec.item(aIndex);
  return new CSSDeclaration(prop, this.mDec.getPropertyValue(prop),
                            this.mDec.getPropertyPriority(prop));
}

/**
 * Handles inserting a CSS declaration
 * @param aRule the rule that will contain the new declaration
 * @param aProperty the property of the new declaration
 * @param aValue the value of the new declaration
 * @param aPriority the priority of the new declaration ("important" or "")
 */
function cmdEditInsert(aRule, aProperty, aValue, aPriority)
{
  this.rule = aRule;
  this.property = aProperty;
  this.value = aValue;
  this.priority = aPriority;
}
cmdEditInsert.prototype =
{
  // remove this line for bug 179621, Phase Three
  txnType: "standard",

  // required for nsITransaction
  QueryInterface: txnQueryInterface,
  merge: txnMerge,
  isTransient: false,

  doTransaction: function doTransaction()
  {
    viewer.mPropsBoxObject.beginUpdateBatch();
    try {
      this.rule.setProperty(this.property, this.value, this.priority);
    }
    finally {
      viewer.mPropsBoxObject.endUpdateBatch();
    }
  },

  undoTransaction: function undoTransaction()
  {
    this.rule.removeProperty(this.property);
    viewer.mPropsBoxObject.invalidate();
  },

  redoTransaction: function redoTransaction()
  {
    this.doTransaction();
  }
}

/**
 * Handles deleting CSS declarations
 * @param aRule the rule containing the declarations
 * @param aDeclarations an array of CSSDeclarations to delete
 */
function cmdEditDelete(aRule, aDeclarations)
{
  this.rule = aRule;
  this.declarations = aDeclarations;
}
cmdEditDelete.prototype =
{
  // remove this line for bug 179621, Phase Three
  txnType: "standard",

  // required for nsITransaction
  QueryInterface: txnQueryInterface,
  merge: txnMerge,
  isTransient: false,

  doTransaction: function doTransaction()
  {
    viewer.mPropsBoxObject.beginUpdateBatch();
    for (var i = 0; i < this.declarations.length; i++)
      this.rule.removeProperty(this.declarations[i].property);
    viewer.mPropsBoxObject.endUpdateBatch();
  },

  undoTransaction: function undoTransaction()
  {
    viewer.mPropsBoxObject.beginUpdateBatch();
    for (var i = 0; i < this.declarations.length; i++)
      this.rule.setProperty(this.declarations[i].property,
                            this.declarations[i].value,
                            this.declarations[i].important ? "important" : "");
  },

  redoTransaction: function redoTransaction()
  {
    this.doTransaction();
  }
}

/**
 * Handles editing CSS declarations
 * @param aRule the rule containing the declaration
 * @param aProperty the property to change
 * @param aNewValue the new value for the property
 * @param aNewValue the new priority for the property ("important" or "")
 */
function cmdEditEdit(aRule, aProperty, aNewValue, aNewPriority)
{
  this.rule = aRule;
  this.property = aProperty;
  this.oldValue = aRule.getPropertyValue(aProperty);
  this.newValue = aNewValue;
  this.oldPriority = aRule.getPropertyPriority(aProperty);
  this.newPriority = aNewPriority;
}
cmdEditEdit.prototype =
{
  // remove this line for bug 179621, Phase Three
  txnType: "standard",

  // required for nsITransaction
  QueryInterface: txnQueryInterface,
  merge: txnMerge,
  isTransient: false,

  doTransaction: function doTransaction()
  {
    this.rule.setProperty(this.property, this.newValue,
                          this.newPriority);
    viewer.mPropsBoxObject.invalidate();
  },

  undoTransaction: function undoTransaction()
  {
    this.rule.setProperty(this.property, this.oldValue,
                          this.oldPriority);
    viewer.mPropsBoxObject.invalidate();
  },

  redoTransaction: function redoTransaction()
  {
    this.doTransaction();
  }
}

/**
 * Handles toggling CSS !important.
 * @param aRule the rule containing the declarations
 * @param aDeclarations an array of CSSDeclarations to toggle
 */
function cmdTogglePriority(aRule, aDeclarations)
{
  this.rule = aRule;
  this.declarations = aDeclarations;
}
cmdTogglePriority.prototype =
{
  // remove this line for bug 179621, Phase Three
  txnType: "standard",

  // required for nsITransaction
  QueryInterface: txnQueryInterface,
  merge: txnMerge,
  isTransient: false,

  doTransaction: function doTransaction()
  {
    for (var i = 0; i < this.declarations.length; i++) {
      //XXX bug 305761 means we can't make something not important, so instead
      // we'll delete this property and make a new one at the proper priority.
      // this method also sucks because the property gets moved to the bottom.
      var property = this.declarations[i].property;
      var value = this.declarations[i].value;
      var newPriority = this.rule.getPropertyPriority(property) == "" ?
                          "important" : "";
      this.rule.removeProperty(property);
      this.rule.setProperty(property, value, newPriority);
    }
    viewer.mPropsBoxObject.invalidate();
  },

  undoTransaction: function undoTransaction()
  {
    this.doTransaction();
  },

  redoTransaction: function redoTransaction()
  {
    this.doTransaction();
  }
}
