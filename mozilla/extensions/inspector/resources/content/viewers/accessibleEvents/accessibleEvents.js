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
 * Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2007
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

/***************************************************************
* AccessibleEventsViewer --------------------------------------------
*  The viewer for the accessible events occured on a document accessible.
* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - 
* REQUIRED IMPORTS:
*   chrome://inspector/content/jsutil/xpcom/XPCU.js
****************************************************************/

///////////////////////////////////////////////////////////////////////////////
//// Global Variables

var viewer;
var gBundle;

///////////////////////////////////////////////////////////////////////////////
//// Global Constants

const kObserverServiceCID = "@mozilla.org/observer-service;1";
const kAccessibleRetrievalCID = "@mozilla.org/accessibleRetrieval;1";

const nsIObserverService = Components.interfaces.nsIObserverService;
const nsIAccessibleRetrieval = Components.interfaces.nsIAccessibleRetrieval;
const nsIAccessibleEvent = Components.interfaces.nsIAccessibleEvent;
const nsIAccessNode = Components.interfaces.nsIAccessNode;

///////////////////////////////////////////////////////////////////////////////
//// Initialization

window.addEventListener("load", AccessibleEventsViewer_initialize, false);

function AccessibleEventsViewer_initialize()
{
  gBundle = document.getElementById("accessiblePropsBundle");

  viewer = new AccessibleEventsViewer();
  viewer.initialize(parent.FrameExchange.receiveData(window));
}

///////////////////////////////////////////////////////////////////////////////
//// class AccessibleEventsViewer

function AccessibleEventsViewer()
{
  this.mURL = window.location;
  this.mObsMan = new ObserverManager(this);

  this.mTree = document.getElementById("olAccessibleEvents");
  this.mOlBox = this.mTree.treeBoxObject;

  this.mWatchContainer = document.getElementById("watchContainer");
  this.mWatchTree = document.getElementById("watchEventList");
  this.mWatchBox = this.mWatchTree.treeBoxObject;
}

AccessibleEventsViewer.prototype =
{
  // initialization

  mSubject: null,
  mPane: null,
  mView: null,

  // interface inIViewer

  get uid() { return "accessibleEvents"; },
  get pane() { return this.mPane; },
  get selection() { return this.mSelection; },

  get subject() { return this.mSubject; },
  set subject(aObject)
  {
    this.mWatchView = new WatchAccessibleEventsListView();
    this.mView = new AccessibleEventsView(aObject, this.mWatchView);

    this.mOlBox.view = this.mView;
    this.mWatchBox.view = this.mWatchView;

    this.mObsMan.dispatchEvent("subjectChange", { subject: aObject });
  },

  initialize: function initialize(aPane)
  {
    this.mPane = aPane;
    aPane.notifyViewerReady(this);
  },

  destroy: function destroy()
  {
    this.mView.destroy();
    this.mOlBox.view = null;
    this.mWatchBox.view = null;
  },

  isCommandEnabled: function isCommandEnabled(aCommand)
  {
    return false;
  },

  getCommand: function getCommand(aCommand)
  {
    return null;
  },

  // event dispatching

  addObserver: function addObserver(aEvent, aObserver)
  {
    this.mObsMan.addObserver(aEvent, aObserver);
  },
  removeObserver: function removeObserver(aEvent, aObserver)
  {
    this.mObsMan.removeObserver(aEvent, aObserver);
  },

  // utils

  onItemSelected: function onItemSelected()
  {
    var idx = this.mTree.currentIndex;
    this.mSelection = this.mView.getDOMNode(idx);
    this.mObsMan.dispatchEvent("selectionChange",
                               { selection: this.mSelection } );
  },

  /**
   * Clear the list of handled events.
   */
  clearEventsList: function clearEventsList()
  {
    this.mView.clear();
  },

  /**
   * Open the panel to choose events to watch.
   */
  chooseEventsToWatch: function chooseEventsToWatch()
  {
    this.mWatchContainer.hidden = !this.mWatchContainer.hidden;
  },

  /**
   * Start or stop to watch all events.
   *
   * @param  aDoWatch  [in] indicates whether to start or stop events watching.
   */
  watchAllEvents: function watchAllEvents(aDoWatch)
  {
    this.mWatchView.watchAllEvents(aDoWatch);
  }
};

///////////////////////////////////////////////////////////////////////////////
//// AccessibleEventsView

function AccessibleEventsView(aDocument, aWatchView)
{
  this.mDocument = aDocument;
  this.mWatchView = aWatchView;
  this.mEvents = [];
  this.mRowCount = 0;

  this.mAccService = XPCU.getService(kAccessibleRetrievalCID,
                                     nsIAccessibleRetrieval);

  this.mAccDocument = this.mAccService.getAccessibleFor(this.mDocument);
  this.mObserverService = XPCU.getService(kObserverServiceCID,
                                          nsIObserverService);

  this.mObserverService.addObserver(this, "accessible-event", false);
}

AccessibleEventsView.prototype = new inBaseTreeView();

AccessibleEventsView.prototype.observe =
function observe(aSubject, aTopic, aData)
{
  var event = XPCU.QI(aSubject, nsIAccessibleEvent);
  var accessible = event.accessible;
  if (!accessible)
    return;

  var accessnode = XPCU.QI(accessible, nsIAccessNode);
  var accDocument = accessnode.accessibleDocument;
  if (accDocument != this.mAccDocument)
    return;

  var type = event.eventType;
  if (!this.mWatchView.isEventWatched(type))
    return;

  var date = new Date();
  var node = accessnode.DOMNode;

  var eventObj = {
    event: event,
    accessnode: accessnode,
    node: node,
    nodename: node ? node.nodeName : "",
    type: this.mAccService.getStringEventType(type),
    time: date.toLocaleTimeString()
  };

  this.mEvents.unshift(eventObj);
  ++this.mRowCount;
  this.mTree.rowCountChanged(0, 1);
}

AccessibleEventsView.prototype.destroy =
function destroy()
{
  this.mObserverService.removeObserver(this, "accessible-event");
}

AccessibleEventsView.prototype.clear =
function clear()
{
  var count = this.mRowCount;
  this.mRowCount = 0;
  this.mEvents = [];
  this.mTree.rowCountChanged(0, -count);
}

AccessibleEventsView.prototype.getDOMNode =
function getDOMNode(aRow)
{
  var event = this.mEvents[aRow].event;
  var DOMNode = this.mEvents[aRow].node;
  var accessNode = this.mEvents[aRow].accessnode;

  DOMNode[" accessible "] = accessNode;
  DOMNode[" accessible event "] = event;
  return DOMNode;
}

AccessibleEventsView.prototype.getCellText =
function getCellText(aRow, aCol)
{
  if (aCol.id == "olcEventType")
    return this.mEvents[aRow].type;
  if (aCol.id == "olcEventTime")
    return this.mEvents[aRow].time;
  if (aCol.id == "olcEventTargetNodeName")
    return this.mEvents[aRow].nodename;
  return "";
}

///////////////////////////////////////////////////////////////////////////////
//// WatchAccessibleEventsListView

const kIgnoredEvents = -1;
const kMutationEvents = 0;
const kChangeEvents = 1;
const kNotificationEvents = 2;
const kSelectionEvents = 3;
const kMenuEvents = 4;
const kDocumentEvents = 5;
const kTextEvents = 6;
const kTableEvents = 7;
const kWindowEvents = 8;
const kHyperLinkEvents = 9;
const kHyperTextEvents = 10;

function WatchAccessibleEventsListView()
{
  // nsITreeView
  this.__proto__ = new inBaseTreeView();

  this.__defineGetter__(
    "rowCount",
    function watchview_getRowCount()
    {
      var rowCount = 0;

      for (var idx = 0; idx < this.mChildren.length; idx++) {
        rowCount++;

        if (this.mChildren[idx].open)
        rowCount += this.mChildren[idx].children.length;
      }

      return rowCount;
    }
  );

  this.getCellText = function watchview_getCellText(aRowIndex, aCol)
  {
    if (aCol.id == "welEventType") {
      var data = this.getData(aRowIndex);
      return data.text;
    }

    return "??";
  };

  this.getCellValue = function watchview_getCellValue(aRowIndex, aCol)
  {
    if (aCol.id == "welIsWatched") {
      var data = this.getData(aRowIndex);
      return data.value;
    }

    return false;
  };

  this.getParentIndex = function watchview_getParentIndex(aRowIndex)
  {
    var info = this.getInfo(aRowIndex);
    return info.parentIndex;
  };

  this.hasNextSibling = function(aRowIndex, aAfterIndex)
  {
    var info = this.getInfo(aRowIndex);
    var siblings = info.parentData.children;
    return siblings[siblings.length - 1] != info.data;
  };

  this.getLevel = function watchview_getLevel(aRowIndex)
  {
    var info = this.getInfo(aRowIndex);
    return info.level;
  };

  this.isContainer = function watchview_isContainer(aRowIndex)
  {
    var info = this.getInfo(aRowIndex);
    return info.level == 0;
  };

  this.isContainerOpen = function watchview_isContainerOpen(aRowIndex)
  {
    var data = this.getData(aRowIndex);
    return data.open;
  };

  this.isContainerEmpty = function watchview_isContainerEmpty(aRowIndex)
  {
    return false;
  };

  this.toggleOpenState = function watchview_toogleOpenState(aRowIndex)
  {
    var data = this.getData(aRowIndex);

    data.open = !data.open;
    var rowCount = data.children.length;

    if (data.open)
      this.mTree.rowCountChanged(aRowIndex + 1, rowCount);
    else
      this.mTree.rowCountChanged(aRowIndex + 1, -rowCount);

    this.mTree.invalidateRow(aRowIndex);
  };

  this.isEditable = function watchview_isEditable(aRowIndex, aCol)
  {
    return true;
  };

  this.setCellValue = function watchview_setCellValue(aRowIndex, aCol, aValue)
  {
    if (aCol.id == "welIsWatched") {
      var newValue = aValue == "true" ? true : false;

      var info = this.getInfo(aRowIndex);
      var data = info.data;

      data.value = newValue;

      if (this.isContainer(aRowIndex)) {
        var children = data.children;
        for (var idx = 0; idx < children.length; idx++)
          children[idx].value = newValue;

        this.mTree.invalidateColumnRange(aRowIndex, aRowIndex + children.length,
                                         aCol);
        return;
      }

      this.mTree.invalidateCell(aRowIndex, aCol);

      var parentData = info.parentData;
      if (parentData.value && !newValue) {
        parentData.value = false;
        this.mTree.invalidateCell(info.parentIndex, aCol);
      }
    }
  };

  //////////////////////////////////////////////////////////////////////////////
  ///// Public

  /**
   * Return true if the given event type is watched.
   */
  this.isEventWatched = function watchview_isEventWatched(aType)
  {
    return this.mReverseData[aType].value;
  };

  /**
   * Start or stop to watch all events.
   */
  this.watchAllEvents = function watchview_watchAllEvents(aAll)
  {
    for (var idx = 0; idx < this.mChildren.length; idx++) {
      var data = this.mChildren[idx];
      data.value = aAll;
      for (var jdx = 0; jdx < data.children.length; jdx++) {
        var subdata = data.children[jdx];
        subdata.value = aAll;
      }
    }

    this.mTree.invalidate();
  };

  //////////////////////////////////////////////////////////////////////////////
  ///// Private

  /**
   * Return the data of the tree item at the given row index.
   */
  this.getData = function watchview_getData(aRowIndex)
  {
    return this.getInfo(aRowIndex).data;
  };

  /**
   * Return an object describing the tree item at the given row index:
   *
   * {
   *   data: null, // the data of tree item
   *   parentIndex: -1, // index of parent row
   *   parentData: null, // the data of parent tree item
   *   level: 0 // the level of the tree item
   * };
   */
  this.getInfo = function watchview_getInfo(aRowIndex)
  {
    var info = {
      data: null,
      parentIndex: -1,
      parentData: null,
      level: 0
    };

    var groupIdx = 0;
    var rowIdx = aRowIndex;

    for (var idx = 0; idx < this.mChildren.length; idx++) {
      var groupItem = this.mChildren[idx];

      if (rowIdx == 0) {
        info.data = groupItem;
        return info;
      }

      rowIdx--;
      if (groupItem.open) {
        var typeItemLen = groupItem.children.length;
        if (rowIdx < typeItemLen) {
          info.data = groupItem.children[rowIdx];
          info.parentIndex = idx;
          info.parentData = groupItem;
          info.level = 1;
          return info;
        }

        rowIdx -= typeItemLen;
      }
    }

    return info;
  };

  /**
   * Initialize the tree view.
   */
  this.init = function watchview_init()
  {
    // Register event groups.
    for (var idx = 0; idx < gEventGroupMap.length; idx++)
      this.registerEventGroup(idx, gBundle.getString(gEventGroupMap[idx]));

    // Register event types.
    for (var idx = 1; idx < gEventTypesMap.length; idx++) {
      var props = gEventTypesMap[idx];
      this.registerEventType(props.group, idx, props.isIgnored);
    }
  };

  /**
   * Add tree item for the group.
   */
  this.registerEventGroup = function watchview_registerEventGroup(aType, aName)
  {
    var item = {
      text: aName,
      value: true,
      open: false,
      children: []
    };

    this.mChildren[aType] = item;
  };

  /**
   * Add tree item for the event type.
   */
  this.registerEventType = function watchview_registerEventType(aGroup, aType,
                                                                aIgnored)
  {
    if (aGroup == kIgnoredEvents)
      return;

    var item = {
      text: this.mAccService.getStringEventType(aType),
      value: !aIgnored
    };

    var groupItem = this.mChildren[aGroup];
    if (aIgnored)
      groupItem.value = false;

    var children = groupItem.children;
    children.push(item);

    this.mReverseData[aType] = item;
  };

  this.mAccService = XPCU.getService(kAccessibleRetrievalCID,
                                     nsIAccessibleRetrieval);

  this.mChildren = [];
  this.mReverseData = [];

  this.init();
}

function eventProps(aGroup, aValue)
{
  this.group = aGroup;
  this.isIgnored = aValue;
}

/**
 * The map of event groups.
 */
var gEventGroupMap =
[
  "mutationEvents", // kMutationEvents
  "changeEvents", // kChangeEvents,
  "notificationEvents", // kNotificationEvents,
  "selectionEvents", // kSelectionEvents
  "menuEvents", // kMenuEvents,
  "documentEvents", // kDocumentEvents,
  "textEvents", // kTextEvents,
  "tableEvents", // kTableEvents,
  "windowEvents", // kWindowEvents,
  "hyperLinkEvents", // kHyperLinkEvents
  "hyperTextEvents", // kHyperTextEvents
];

/**
 * The map of event types. Events are listed in the order of nsIAccessibleEvent.
 */
var gEventTypesMap =
[
  new eventProps(kIgnoredEvents), // No event

  new eventProps(kMutationEvents), // EVENT_SHOW
  new eventProps(kMutationEvents), // EVENT_HIDE
  new eventProps(kMutationEvents), // EVENT_REORDER

  new eventProps(kChangeEvents), // EVENT_ACTIVE_DECENDENT_CHANGED

  new eventProps(kNotificationEvents), // EVENT_FOCUS

  new eventProps(kChangeEvents), // EVENT_STATE_CHANGE
  new eventProps(kChangeEvents), // EVENT_LOCATION_CHANGE
  new eventProps(kChangeEvents), // EVENT_NAME_CHANGE
  new eventProps(kChangeEvents), // EVENT_DESCRIPTION_CHANGE
  new eventProps(kChangeEvents), // EVENT_VALUE_CHANGE
  new eventProps(kChangeEvents), // EVENT_HELP_CHANGE
  new eventProps(kChangeEvents), // EVENT_DEFACTION_CHANGE
  new eventProps(kChangeEvents), // EVENT_ACTION_CHANGE
  new eventProps(kChangeEvents), // EVENT_ACCELERATOR_CHANGE

  new eventProps(kSelectionEvents), // EVENT_SELECTION
  new eventProps(kSelectionEvents), // EVENT_SELECTION_ADD
  new eventProps(kSelectionEvents), // EVENT_SELECTION_REMOVE
  new eventProps(kSelectionEvents), // EVENT_SELECTION_WITHIN

  new eventProps(kNotificationEvents), // EVENT_ALERT
  new eventProps(kNotificationEvents), // EVENT_FOREGROUND

  new eventProps(kMenuEvents), // EVENT_MENU_START
  new eventProps(kMenuEvents), // EVENT_MENU_END
  new eventProps(kMenuEvents), // EVENT_MENUPOPUP_START
  new eventProps(kMenuEvents), // EVENT_MENUPOPUP_END

  new eventProps(kNotificationEvents), // EVENT_CAPTURE_START
  new eventProps(kNotificationEvents), // EVENT_CAPTURE_END
  new eventProps(kNotificationEvents), // EVENT_MOVESIZE_START
  new eventProps(kNotificationEvents), // EVENT_MOVESIZE_END
  new eventProps(kNotificationEvents), // EVENT_CONTEXTHELP_START
  new eventProps(kNotificationEvents), // EVENT_CONTEXTHELP_END
  new eventProps(kNotificationEvents, true), // EVENT_DRAGDROP_START
  new eventProps(kNotificationEvents, true), // EVENT_DRAGDROP_END
  new eventProps(kNotificationEvents), // EVENT_DIALOG_START
  new eventProps(kNotificationEvents), // EVENT_DIALOG_END
  new eventProps(kNotificationEvents), // EVENT_SCROLLING_START
  new eventProps(kNotificationEvents), // EVENT_SCROLLING_END
  new eventProps(kNotificationEvents), // EVENT_MINIMIZE_START
  new eventProps(kNotificationEvents), // EVENT_MINIMIZE_END

  new eventProps(kDocumentEvents), // EVENT_DOCUMENT_LOAD_START
  new eventProps(kDocumentEvents), // EVENT_DOCUMENT_LOAD_COMPLETE
  new eventProps(kDocumentEvents), // EVENT_DOCUMENT_RELOAD
  new eventProps(kDocumentEvents), // EVENT_DOCUMENT_LOAD_STOPPED
  new eventProps(kDocumentEvents), // EVENT_DOCUMENT_ATTRIBUTES_CHANGED
  new eventProps(kDocumentEvents), // EVENT_DOCUMENT_CONTENT_CHANGED

  new eventProps(kChangeEvents), // EVENT_PROPERTY_CHANGED

  new eventProps(kSelectionEvents), // EVENT_SELECTION_CHANGED

  new eventProps(kChangeEvents), // EVENT_TEXT_ATTRIBUTE_CHANGED

  new eventProps(kTextEvents), // EVENT_TEXT_CARET_MOVED
  new eventProps(kTextEvents), // EVENT_TEXT_CHANGED
  new eventProps(kTextEvents), // EVENT_TEXT_INSERTED
  new eventProps(kTextEvents), // EVENT_TEXT_REMOVED
  new eventProps(kTextEvents), // EVENT_TEXT_UPDATED
  new eventProps(kTextEvents), // EVENT_TEXT_SELECTION_CHANGED

  new eventProps(kNotificationEvents), // EVENT_VISIBLE_DATA_CHANGED
  new eventProps(kNotificationEvents), // EVENT_TEXT_COLUMN_CHANGED
  new eventProps(kNotificationEvents), // EVENT_SECTION_CHANGED

  new eventProps(kTableEvents), // EVENT_TABLE_CAPTION_CHANGED
  new eventProps(kTableEvents), // EVENT_TABLE_MODEL_CHANGED
  new eventProps(kTableEvents), // EVENT_TABLE_SUMMARY_CHANGED
  new eventProps(kTableEvents), // EVENT_TABLE_ROW_DESCRIPTION_CHANGED
  new eventProps(kTableEvents), // EVENT_TABLE_ROW_HEADER_CHANGED
  new eventProps(kTableEvents), // EVENT_TABLE_ROW_INSERT
  new eventProps(kTableEvents), // EVENT_TABLE_ROW_DELETE
  new eventProps(kTableEvents), // EVENT_TABLE_ROW_REORDER
  new eventProps(kTableEvents), // EVENT_TABLE_COLUMN_DESCRIPTION_CHANGED
  new eventProps(kTableEvents), // EVENT_TABLE_COLUMN_HEADER_CHANGED
  new eventProps(kTableEvents), // EVENT_TABLE_COLUMN_INSERT
  new eventProps(kTableEvents), // EVENT_TABLE_COLUMN_DELETE
  new eventProps(kTableEvents), // EVENT_TABLE_COLUMN_REORDER

  new eventProps(kWindowEvents), // EVENT_WINDOW_ACTIVATE
  new eventProps(kWindowEvents), // EVENT_WINDOW_CREATE
  new eventProps(kWindowEvents), // EVENT_WINDOW_DEACTIVATE
  new eventProps(kWindowEvents), // EVENT_WINDOW_DESTROY
  new eventProps(kWindowEvents), // EVENT_WINDOW_MAXIMIZE
  new eventProps(kWindowEvents), // EVENT_WINDOW_MINIMIZE
  new eventProps(kWindowEvents), // EVENT_WINDOW_RESIZE
  new eventProps(kWindowEvents), // EVENT_WINDOW_RESTORE

  new eventProps(kHyperLinkEvents), // EVENT_HYPERLINK_END_INDEX_CHANGED
  new eventProps(kHyperLinkEvents), // EVENT_HYPERLINK_NUMBER_OF_ANCHORS_CHANGED
  new eventProps(kHyperLinkEvents), // EVENT_HYPERLINK_SELECTED_LINK_CHANGED

  new eventProps(kHyperTextEvents), // EVENT_HYPERTEXT_LINK_ACTIVATED
  new eventProps(kHyperTextEvents), // EVENT_HYPERTEXT_LINK_SELECTED

  new eventProps(kHyperLinkEvents), // EVENT_HYPERLINK_START_INDEX_CHANGED

  new eventProps(kHyperTextEvents), // EVENT_HYPERTEXT_CHANGED
  new eventProps(kHyperTextEvents), // EVENT_HYPERTEXT_NLINKS_CHANGED

  new eventProps(kChangeEvents), // EVENT_OBJECT_ATTRIBUTE_CHANGED
  new eventProps(kChangeEvents), // EVENT_PAGE_CHANGED

  new eventProps(kDocumentEvents) // EVENT_INTERNAL_LOAD
];
