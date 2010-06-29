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
* StyleSheetsViewer ----------------------------------------------------------
*  The viewer for the style sheets loaded by a document.
* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
* REQUIRED IMPORTS:
*   chrome://inspector/content/jsutil/xpcom/XPCU.js
*****************************************************************************/

//////////////////////////////////////////////////////////////////////////////
//// Global Variables

var viewer;

//////////////////////////////////////////////////////////////////////////////

window.addEventListener("load", StyleSheetsViewer_initialize, false);

function StyleSheetsViewer_initialize()
{
  viewer = new StyleSheetsViewer();
  viewer.initialize(parent.FrameExchange.receiveData(window));
}

//////////////////////////////////////////////////////////////////////////////
//// Class StyleSheetsViewer

function StyleSheetsViewer()
{
  this.mURL = window.location;
  this.mObsMan = new ObserverManager(this);

  this.mTree = document.getElementById("olStyleSheets");
  this.mOlBox = this.mTree.treeBoxObject;
}

StyleSheetsViewer.prototype =
{
  ////////////////////////////////////////////////////////////////////////////
  //// Initialization

  mSubject: null,
  mPane: null,
  mView: null,

  ////////////////////////////////////////////////////////////////////////////
  //// Interface inIViewer

  get uid() { return "stylesheets"; },
  get pane() { return this.mPane; },
  get selection() { return this.mSelection; },

  get subject() { return this.mSubject; },
  set subject(aObject)
  {
    this.mView = new StyleSheetsView(aObject);
    this.mOlBox.view = this.mView;
    this.mObsMan.dispatchEvent("subjectChange", { subject: aObject });
    this.mView.selection.select(0);
  },

  initialize: function SSVr_Initialize(aPane)
  {
    this.mPane = aPane;
    aPane.notifyViewerReady(this);
  },

  destroy: function SSVr_Destroy()
  {
    this.mOlBox.view = null;
  },

  isCommandEnabled: function SSVr_IsCommandEnabled(aCommand)
  {
    return false;
  },

  getCommand: function SSVr_GetCommand(aCommand)
  {
    return null;
  },

  ////////////////////////////////////////////////////////////////////////////
  //// Event Dispatching

  addObserver: function SSVr_AddObserver(aEvent, aObserver)
  {
    this.mObsMan.addObserver(aEvent, aObserver);
  },

  removeObserver: function SSVr_RemoveObserver(aEvent, aObserver)
  {
    this.mObsMan.removeObserver(aEvent, aObserver);
  },

  ////////////////////////////////////////////////////////////////////////////
  //// Stuff

  onItemSelected: function SSVr_OnItemSelected()
  {
    var idx = this.mTree.currentIndex;
    this.mSelection = this.mView.getSheet(idx);
    this.mObsMan.dispatchEvent("selectionChange",
                               { selection: this.mSelection });
  }

};

//////////////////////////////////////////////////////////////////////////////
//// StyleSheetsView

function StyleSheetsView(aDocument)
{
  this.mDocument = aDocument;
  this.mSheets = [];
  this.mLevels = [];
  this.mOpen = [];
  this.mChildCount = [];
  this.mRowCount = 0;

  var ss = aDocument.styleSheets;
  for (let i = 0; i < ss.length; ++i)
    this.insertSheet(ss[i], 0, -1);
}

StyleSheetsView.prototype = new inBaseTreeView();

StyleSheetsView.prototype.getSheet =
function SSV_GetSheet(aRow)
{
  return this.mSheets[aRow];
}

StyleSheetsView.prototype.insertSheet =
function SSV_InsertSheet(aSheet, aLevel, aRow)
{
  var row = aRow < 0 ? this.mSheets.length : aRow;

  this.mSheets[row] = aSheet;
  this.mLevels[row] = aLevel;
  this.mOpen[row] = false;

  var count = 0;
  var rules = aSheet.cssRules;
  for (let i = 0; i < rules.length; ++i) {
    if (rules[i].type == CSSRule.IMPORT_RULE)
      ++count;
  }
  this.mChildCount[row] = count;
  ++this.mRowCount;
}

//////////////////////////////////////////////////////////////////////////////
//// Interface nsITreeView

StyleSheetsView.prototype.getCellText =
function SSV_GetCellText(aRow, aCol)
{
  var rule = this.mSheets[aRow];
  if (aCol.id == "olcHref") {
    if (rule.href)
      return rule.href;
    // fall back for style elements
    if (rule.ownerNode && rule.ownerNode.ownerDocument)
      return rule.ownerNode.ownerDocument.documentURI;
  }
  else if (aCol.id == "olcRules") {
    return this.mSheets[aRow].cssRules.length;
  }
  return "";
}

StyleSheetsView.prototype.getLevel =
function SSV_GetLevel(aRow)
{
  return this.mLevels[aRow];
}

StyleSheetsView.prototype.isContainer =
function SSV_IsContainer(aRow)
{
  return this.mChildCount[aRow] > 0;
}

StyleSheetsView.prototype.isContainerEmpty =
function SSV_IsContainerEmpty(aRow)
{
  return !this.isContainer(aRow);
}

StyleSheetsView.prototype.getParentIndex =
function SSV_GetParentIndex(aRow)
{
  var baseLevel = this.mLevels[aRow];
  for (let i = aRow - 1; i >= 0; --i) {
    if (this.mLevels[i] < baseLevel)
      return i;
  }
  return -1;
}

StyleSheetsView.prototype.hasNextSibling =
function SSV_HasNextSibling(aRow, aAfter)
{
  var baseLevel = this.mLevels[aRow];
  for (let i = aAfter + 1; i < this.mRowCount; ++i) {
    if (this.mLevels[i] < baseLevel)
      break;
    if (this.mLevels[i] == baseLevel)
      return true;
  }
  return false;
}

StyleSheetsView.prototype.isContainerOpen =
function SSV_IsContainerOpen(aRow)
{
  return this.mOpen[aRow];
}

StyleSheetsView.prototype.toggleOpenState =
function SSV_ToggleOpenState(aRow)
{
  var changeCount = 0;
  if (this.mOpen[aRow]) {
    var baseLevel = this.mLevels[aRow];
    for (let i = aRow + 1; i < this.mRowCount; ++i) {
      if (this.mLevels[i] <= baseLevel)
        break;
      ++changeCount;
    }
    // shift data up
    this.mSheets.splice(aRow + 1, changeCount);
    this.mLevels.splice(aRow + 1, changeCount);
    this.mOpen.splice(aRow + 1, changeCount);
    this.mChildCount.splice(aRow + 1, changeCount);
    changeCount = -changeCount;
    this.mRowCount += changeCount;
  } else {
    // for quick access
    var rules = this.mSheets[aRow].cssRules;
    var level = this.mLevels[aRow] + 1;
    var childCount = this.mChildCount[aRow];
    // shift data down
    for (let i = this.mRowCount - 1; i > aRow; --i) {
      this.mSheets[i + childCount] = this.mSheets[i];
      this.mLevels[i + childCount] = this.mLevels[i];
      this.mOpen[i + childCount] = this.mOpen[i];
      this.mChildCount[i + childCount] = this.mChildCount[i];
    }
    // fill in new rows
    for (let i = 0; i < rules.length; ++i) {
      if (rules[i].type == CSSRule.IMPORT_RULE) {
        ++changeCount;
        this.insertSheet(rules[i].styleSheet, level, aRow + changeCount);
      }
      else if (rules[i].type != CSSRule.CHARSET_RULE) {
        // only @charset and other @imports may precede @import, so exit now
        break;
      }
    }
  }

  this.mOpen[aRow] = !this.mOpen[aRow];
  this.mTree.rowCountChanged(aRow + 1, changeCount);
  this.mTree.invalidateRow(aRow);
}

