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
 * The Original Code is DOM Inspector.
 *
 * The Initial Developer of the Original Code is
 * Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Alexander Surkov <surkov.alexander@gmail.com> (original author)
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

////////////////////////////////////////////////////////////////////////////////
//// Global

const nsIAccessibleTableCell = Components.interfaces.nsIAccessibleTableCell;


////////////////////////////////////////////////////////////////////////////////
//// Accessible property viewer manager

/**
 * Used to show additional properties of the accessible in tabbox.
 *
 * @param aPaneElm
 *        A pane element where the view is hosted.
 */
function accessiblePropViewerMgr(aPaneElm)
{
  /**
   * Updates all property views for the given accessible.
   *
   * @param aAccessible
   *        The given accessible
   */
  this.updateViews = function accessiblePropViewerMgr_updateViews(aAccessible)
  {
    for (var id in this.viewers)
    {
      var tab = document.getElementById("tab_" + id);
      tab.hidden = !this.viewers[id].update(aAccessible);
    }

    this.tabboxElm.selectedIndex = this.getCurrentViewerIdx();
  }

  /**
   * Clear the data of property views.
   */
  this.clearViews = function accessiblePropViewerMgr_clearViews()
  {
    for (var id in this.viewers)
    {
      this.viewers[id].clear();

      var tab = document.getElementById("tab_" + id);
      tab.hidden = true;
    }
  }

  /**
   * Process 'inspectInNewView' command for selected property view.
   */
  this.inspectInNewView = function accessiblePropViewerMgr_inspectInNewView()
  {
    var tab = this.tabboxElm.selectedTab;
    var viewrid = tab.id.replace("tab_", "");
    this.viewers[viewrid].inspectInNewView();
  }

  //////////////////////////////////////////////////////////////////////////////
  //// private

  this.handleEvent = function accessiblePropViewerMgr_handleEvent(aEvent)
  {
    this.setCurrentViewerIdx(this.tabboxElm.selectedIndex);
  }

  this.setCurrentViewerIdx = function accessiblePropViewerMgr_setCurrentViewerIdx(aIdx)
  {
    this.paneElm.accessiblePropsCurrentViewerIdx = aIdx;
  }

  this.getCurrentViewerIdx = function accessiblePropViewerMgr_getCurrentViewerIdx()
  {
    var idx = this.paneElm.accessiblePropsCurrentViewerIdx;

    idx = idx ? idx : 0;
    var tab = this.tabsElm.children[idx];
    if (tab.hidden)
      return 0;

    return idx;
  }

  this.viewers = {
    "attributes": new attributesViewer(),
    "tablecell": new tableCellViewer()
  };

  this.tabboxElm = document.getElementById("tabviewers");
  this.tabsElm = this.tabboxElm.tabs;
  this.tabsElm.addEventListener("select", this, false);
  this.paneElm = aPaneElm;
}


////////////////////////////////////////////////////////////////////////////////
//// Accessible property viewers

/**
 * Object attribute property view. Used to display accessible attributes.
 */
function attributesViewer()
{
  /**
   * Updates the view for the given accessible.
   *
   * @param aAccessible
   *        The given accessible
   */
  this.update = function attributesViewer_update(aAccessible)
  {
    var attrs = aAccessible.attributes;
    if (attrs) {
      var enumerate = attrs.enumerate();
      while (enumerate.hasMoreElements())
        this.addAttribute(enumerate.getNext());
    }

    return true;
  }

  /**
   * Clear the view's data.
   */
  this.clear = function attributesViewer_clear()
  {
    var trAttrBody = document.getElementById("trAttrBody");
    while (trAttrBody.hasChildNodes())
      trAttrBody.removeChild(trAttrBody.lastChild)
  }

  /**
   * Prepares 'inspectInNewView' command.
   */
  this.inspectInNewView = function attributesViewer_inspectInNewView()
  {
  }

  //////////////////////////////////////////////////////////////////////////////
  //// private

  this.addAttribute = function attrbiutesViewer_addAttribute(aElement)
  {
    var prop = XPCU.QI(aElement, nsIPropertyElement);
    
    var trAttrBody = document.getElementById("trAttrBody");
    
    var ti = document.createElement("treeitem");
    var tr = document.createElement("treerow");
    
    var tc = document.createElement("treecell");
    tc.setAttribute("label", prop.key);
    tr.appendChild(tc);
    
    tc = document.createElement("treecell");
    tc.setAttribute("label", prop.value);
    tr.appendChild(tc);
    
    ti.appendChild(tr);
    
    trAttrBody.appendChild(ti);
  }
}

/**
 * Table cell property view. Used to display table cell properties of the
 * accessible implementing nsIAccessibleTableCell.
 */
function tableCellViewer()
{
  /**
   * Updates the view for the given accessible.
   *
   * @param aAccessible
   *        The given accessible
   */
  this.update = function tableCellViewer_update(aAccessible)
  {
    if (!(aAccessible instanceof nsIAccessibleTableCell))
      return false;

    // columnIndex
    var columnIndex = aAccessible.columnIndex;
    this.columnIndexElm.textContent = columnIndex;

    // rowIndex
    var rowIndex = aAccessible.rowIndex;
    this.rowIndexElm.textContent = rowIndex;

    // columnExtent
    var columnExtent = aAccessible.columnExtent;
    this.columnExtentElm.textContent = columnExtent;
    
    // rowIndex
    var rowExtent = aAccessible.rowExtent;
    this.rowExtentElm.textContent = rowExtent;

    // isSelected
    var isSelected = aAccessible.isSelected();
    this.isSelectedElm.textContent = isSelected;

    // table, columnHeaderCells, rowHeaderCells
    this.addRelated(aAccessible);

    return true;
  }

  /**
   * Clear the view's data.
   */
  this.clear = function tableCellViewer_clear()
  {
    this.mTreeBox.view = null;

    this.columnIndexElm.textContent = "";
    this.rowIndexElm.textContent = "";
    this.columnExtentElm.textContent = "";
    this.rowExtentElm.textContent = "";
    this.isSelectedElm.textContent = "";
  }

  /**
   * Prepares 'inspectInNewView' command.
   */
  this.inspectInNewView = function tableCellViewer_inspectInNewView()
  {
    var idx = this.mTree.currentIndex;
    if (idx >= 0) {
      var node = this.mTreeView.getDOMNode(idx);
      if (node)
        inspectObject(node);
    }
  }

  //////////////////////////////////////////////////////////////////////////////
  //// private

  this.addRelated = function tableCellViewer_addRelated(aAccessible)
  {
    this.mTreeView = new TableCellTreeView(aAccessible);
    this.mTreeBox.view = this.mTreeView;
  }

  this.mTree = document.getElementById("tableCell:accObjects");
  this.mTreeBox = this.mTree.treeBoxObject;

  this.columnIndexElm = document.getElementById("tableCell:columnIndex");
  this.rowIndexElm = document.getElementById("tableCell:rowIndex");
  this.columnExtentElm = document.getElementById("tableCell:columnExtent");
  this.rowExtentElm = document.getElementById("tableCell:rowExtent");
  this.isSelectedElm = document.getElementById("tableCell:isSelected");
}


///////////////////////////////////////////////////////////////////////////////
//// TableCellTreeView. nsITreeView

function TableCellTreeView(aTableCell)
{
  this.tableCell = aTableCell;
  this.mRowCount = this.getRowCount();
}

TableCellTreeView.prototype = new inBaseTreeView();

TableCellTreeView.prototype.getRowCount =
  function TableCellTreeView_rowCount()
{
  this.columnHeaderCells = this.tableCell.columnHeaderCells;
  this.columnHeaderCellsLen = (this.columnHeaderCells ?
                               this.columnHeaderCells.length : 0);

  this.rowHeaderCells = this.tableCell.rowHeaderCells;
  this.rowHeaderCellsLen = (this.rowHeaderCells ?
                            this.rowHeaderCells.length : 0);

  return 1 + this.columnHeaderCellsLen + this.rowHeaderCellsLen;
}

TableCellTreeView.prototype.getCellText =
  function TableCellTreeView_getCellText(aRow, aCol)
{
  var accessible = this.getAccessible(aRow);
  if (!accessible)
    return "";

  if (aCol.id == "tableCell:property") {
    return this.getPropertyName(aRow);

  } else if (aCol.id == "tableCell:role") {
    return gAccService.getStringRole(accessible.role);

  } else if (aCol.id == "tableCell:name") {
    return accessible.name;

  } else if (aCol.id == "tableCell:nodeName") {
    var node = this.getDOMNode(aRow);
    if (node)
      return node.nodeName;
  }

  return "";
}

///////////////////////////////////////////////////////////////////////////////
//// TableCellTreeView. Utils

/**
 * Return an accessible for the given row index.
 *
 * @param aRow
 *        Row index
 */
TableCellTreeView.prototype.getAccessible =
  function TableCellTreeView_getAccessible(aRow)
{
  if (aRow == 0)
    return this.tableCell.table;

  if (aRow <= this.columnHeaderCellsLen)
    return this.columnHeaderCells.queryElementAt(aRow - 1, nsIAccessible);

  return this.rowHeaderCells.queryElementAt(aRow - 1 - this.columnHeaderCellsLen, nsIAccessible);
}

/**
 * Retrun interface attribute name (property) used at the given row index.
 *
 * @param aRow
 *        Row index
 */
TableCellTreeView.prototype.getPropertyName =
  function TableCellTreeView_getPropertyName(aRow)
{
  if (aRow == 0)
    return "table";
  
  if (aRow <= this.columnHeaderCellsLen)
    return "column header cell";
  
  return "row header cell";
}

/**
 * Return DOM node at the given row index.
 *
 * @param aRow
 *        Row index
 */
TableCellTreeView.prototype.getDOMNode =
  function TableCellTreeView_getDOMNode(aRow)
{
  var accessNode = XPCU.QI(this.getAccessible(aRow), nsIAccessNode);
  if (!accessNode)
    return null;

  var DOMNode = accessNode.DOMNode;
  DOMNode[" accessible "] = accessNode;
  return DOMNode;
}
