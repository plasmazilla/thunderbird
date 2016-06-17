/* -*- Mode: javascript; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 ; js-indent-level: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource:///modules/mailServices.js");
Components.utils.import("resource:///modules/IOUtils.js");

var gDirTree;
var abList = 0;
var gAbResultsTree = null;
var gAbView = null;
var gAddressBookBundle;
// A boolean variable determining whether AB column should be shown in AB
// sidebar in compose window.
var gShowAbColumnInComposeSidebar = false;

var kDefaultSortColumn = "GeneratedName";
var kDefaultAscending = "ascending";
var kDefaultDescending = "descending";
// kDefaultYear will be used in birthday calculations when no year is given;
// this is a leap year so that Feb 29th works.
const kDefaultYear = nearestLeap(new Date().getFullYear());
const kMaxYear = 9999;
const kMinYear = 1;
var kAllDirectoryRoot = "moz-abdirectory://";
var kLdapUrlPrefix = "moz-abldapdirectory://";
var kPersonalAddressbookURI = "moz-abmdbdirectory://abook.mab";
var kCollectedAddressbookURI = "moz-abmdbdirectory://history.mab";
// The default, generic contact image is displayed via CSS when the photoURI is
// blank.
var defaultPhotoURI = "";

var PERMS_DIRECTORY = parseInt("0755", 8);

// Controller object for Dir Pane
var DirPaneController =
{
  supportsCommand: function(command)
  {
    switch (command) {
      case "cmd_selectAll":
      case "cmd_delete":
      case "button_delete":
      case "cmd_properties":
      case "cmd_printcard":
      case "cmd_printcardpreview":
      case "cmd_newlist":
      case "cmd_newCard":
        return true;
      default:
        return false;
    }
  },

  isCommandEnabled: function(command)
  {
    var selectedDir;

    switch (command) {
      case "cmd_selectAll":
        // the gDirTree pane
        // only handles single selection
        // so we forward select all to the results pane
        // but if there is no gAbView
        // don't bother sending to the results pane
        return (gAbView != null);
      case "cmd_delete":
      case "button_delete":
        var selectedDir = GetSelectedDirectory();
        if (command == "cmd_delete" && selectedDir)
          goSetMenuValue(command, GetDirectoryFromURI(selectedDir).isMailList ?
                                  "valueList" : "valueAddressBook");

        if (selectedDir &&
            (selectedDir != kPersonalAddressbookURI) &&
            (selectedDir != kCollectedAddressbookURI) &&
            (selectedDir != (kAllDirectoryRoot + "?"))) {
          // If the directory is a mailing list, and it is read-only, return
          // false.
          var abDir = GetDirectoryFromURI(selectedDir);
          if (abDir.isMailList && abDir.readOnly)
            return false;

          // If the selected directory is an ldap directory
          // and if the prefs for this directory are locked
          // disable the delete button.
          if (selectedDir.startsWith(kLdapUrlPrefix))
          {
            var disable = false;
            try {
              var prefName = selectedDir.substr(kLdapUrlPrefix.length);
              disable = Services.prefs.getBoolPref(prefName + ".disable_delete");
            }
            catch(ex) {
              // if this preference is not set its ok.
            }
            if (disable)
              return false;
          }
          return true;
        }
        else
          return false;
      case "cmd_printcard":
      case "cmd_printcardpreview":
        return (GetSelectedCardIndex() != -1);
      case "cmd_properties":
        return (GetSelectedDirectory() != null);
      case "cmd_newlist":
      case "cmd_newCard":
        return true;
      default:
        return false;
    }
  },

  doCommand: function(command)
  {
    switch (command) {
      case "cmd_printcard":
      case "cmd_printcardpreview":
      case "cmd_selectAll":
        SendCommandToResultsPane(command);
        break;
      case "cmd_delete":
      case "button_delete":
        if (gDirTree)
          AbDeleteSelectedDirectory();
        break;
      case "cmd_properties":
        AbEditSelectedDirectory();
        break;
      case "cmd_newlist":
        AbNewList();
        break;
      case "cmd_newCard":
        AbNewCard();
        break;
    }
  },

  onEvent: function(event)
  {
    // on blur events set the menu item texts back to the normal values
    if (event == "blur")
      goSetMenuValue("cmd_delete", "valueDefault");
  }
};

function SendCommandToResultsPane(command)
{
  ResultsPaneController.doCommand(command);

  // if we are sending the command so the results pane
  // we should focus the results pane
  gAbResultsTree.focus();
}

function AbNewLDAPDirectory()
{
  window.openDialog("chrome://messenger/content/addressbook/pref-directory-add.xul",
                    "",
                    "chrome,modal,resizable=no,centerscreen",
                    null);
}

function AbNewAddressBook()
{
  window.openDialog("chrome://messenger/content/addressbook/abAddressBookNameDialog.xul",
                    "",
                    "chrome,modal,resizable=no,centerscreen",
                    null);
}

function AbEditSelectedDirectory()
{
  if (gDirTree.view.selection.count == 1) {
    var selecteduri = GetSelectedDirectory();
    var directory = GetDirectoryFromURI(selecteduri);
    if (directory.isMailList) {
      var dirUri = GetParentDirectoryFromMailingListURI(selecteduri);
      goEditListDialog(null, selecteduri);
    }
    else {
      window.openDialog(directory.propertiesChromeURI,
                        "",
                        "chrome,modal,resizable=no,centerscreen",
                        {selectedDirectory: directory});
    }
  }
}

function AbDeleteSelectedDirectory()
{
  var selectedABURI = GetSelectedDirectory();
  if (!selectedABURI)
    return;

  AbDeleteDirectory(selectedABURI);
}

function AbDeleteDirectory(aURI)
{
  var directory = GetDirectoryFromURI(aURI);
  var confirmDeleteMessage;
  var clearPrefsRequired = false;

  if (directory.isMailList)
    confirmDeleteMessage = gAddressBookBundle.getString("confirmDeleteMailingList");
  else {
    // Check if this address book is being used for collection
    if (Services.prefs.getCharPref("mail.collect_addressbook") == aURI &&
        Services.prefs.getBoolPref("mail.collect_email_address_outgoing")) {
      var brandShortName = document.getElementById("bundle_brand").getString("brandShortName");

      confirmDeleteMessage = gAddressBookBundle.getFormattedString("confirmDeleteCollectionAddressbook", [brandShortName]);
      clearPrefsRequired = true;
    }
    else {
      confirmDeleteMessage = gAddressBookBundle.getString("confirmDeleteAddressbook");
    }
  }

  if (!Services.prompt.confirm(window,
                               gAddressBookBundle.getString(
                                                  directory.isMailList ?
                                                  "confirmDeleteMailingListTitle" :
                                                  "confirmDeleteAddressbookTitle"),
                               confirmDeleteMessage))
    return;

  // First clear/reset the prefs if required
  if (clearPrefsRequired) {
    Services.prefs.setBoolPref("mail.collect_email_address_outgoing", false);

    // Also reset the displayed value so that we don't get a blank item in the
    // prefs dialog if it gets enabled.
    Services.prefs.setCharPref("mail.collect_addressbook", kPersonalAddressbookURI);
  }

  MailServices.ab.deleteAddressBook(aURI);
}

function GetParentRow(aTree, aRow)
{
  var row = aRow;
  var level = aTree.view.getLevel(row);
  var parentLevel = level;
  while (parentLevel >= level) {
    row--;
    if (row == -1)
      return row;
    parentLevel = aTree.view.getLevel(row);
  }
  return row;
}

function InitCommonJS()
{
  gDirTree = document.getElementById("dirTree");
  abList = document.getElementById("addressbookList");
  gAddressBookBundle = document.getElementById("bundle_addressBook");

  // Make an entry for "All Address Books".
  if (abList) {
    abList.insertItemAt(0, gAddressBookBundle.getString("allAddressBooks"),
                        kAllDirectoryRoot + "?");
  }
}

function AbDelete()
{
  var types = GetSelectedCardTypes();
  if (types == kNothingSelected)
    return;

  // If at least one mailing list is selected then prompt users for deletion.

  var confirmDeleteMessage;
  if (types == kListsAndCards)
    confirmDeleteMessage = gAddressBookBundle.getString("confirmDeleteListsAndContacts");
  else if (types == kMultipleListsOnly)
    confirmDeleteMessage = gAddressBookBundle.getString("confirmDeleteMailingLists");
  else if (types == kSingleListOnly)
    confirmDeleteMessage = gAddressBookBundle.getString("confirmDeleteMailingList");
  else if (types == kCardsOnly && gAbView && gAbView.selection) {
    if (gAbView.selection.count < 2)
      confirmDeleteMessage = gAddressBookBundle.getString("confirmDeleteContact");
    else
      confirmDeleteMessage = gAddressBookBundle.getString("confirmDeleteContacts");
  }

  if (confirmDeleteMessage &&
      Services.prompt.confirm(window, null, confirmDeleteMessage)) {
    if (GetSelectedDirectory() != (kAllDirectoryRoot + "?")) {
      gAbView.deleteSelectedCards();
    } else {
      let cards = GetSelectedAbCards();
      for (let i = 0; i < cards.length; i++) {
        let dirId = cards[i].directoryId
                            .substring(0, cards[i].directoryId.indexOf("&"));
        let directory = MailServices.ab.getDirectoryFromId(dirId);

        let cardArray =
          Components.classes["@mozilla.org/array;1"]
                    .createInstance(Components.interfaces.nsIMutableArray);
        cardArray.appendElement(cards[i], false);
        if (directory)
          directory.deleteCards(cardArray);
      }

      SetAbView(kAllDirectoryRoot + "?");
    }
  }
}

function AbNewCard()
{
  goNewCardDialog(GetSelectedDirectory());
}

function AbEditCard(card)
{
  // Need a card,
  // but not allowing AOL special groups to be edited.
  if (!card)
    return;

  if (card.isMailList) {
    goEditListDialog(card, card.mailListURI);
  }
  else {
    goEditCardDialog(GetSelectedDirectory(), card);
  }
}

function AbNewMessage()
{
  var msgComposeType = Components.interfaces.nsIMsgCompType;
  var msgComposFormat = Components.interfaces.nsIMsgCompFormat;

  var params = Components.classes["@mozilla.org/messengercompose/composeparams;1"].createInstance(Components.interfaces.nsIMsgComposeParams);
  if (params)
  {
    params.type = msgComposeType.New;
    params.format = msgComposFormat.Default;
    var composeFields = Components.classes["@mozilla.org/messengercompose/composefields;1"].createInstance(Components.interfaces.nsIMsgCompFields);
    if (composeFields)
    {
      if (DirPaneHasFocus())
      {
        var directory = gDirectoryTreeView.getDirectoryAtIndex(gDirTree.currentIndex);
        var hidesRecipients = false;

        try {
          // This is a bit of hackery so that extensions can have mailing lists
          // where recipients are sent messages via BCC.
          hidesRecipients = directory.getBoolValue("HidesRecipients", false);
        } catch(e) {
          // Standard Thunderbird mailing lists do not have preferences
          // associated with them, so we'll silently eat the error.
        }

        if (directory && directory.isMailList && hidesRecipients)
          // Bug 669301 (https://bugzilla.mozilla.org/show_bug.cgi?id=669301)
          // We're using BCC right now to hide recipients from one another.
          // We should probably use group syntax, but that's broken
          // right now, so this will have to do.
          composeFields.bcc = GetSelectedAddressesFromDirTree();
        else
          composeFields.to = GetSelectedAddressesFromDirTree();
      }
      else
        composeFields.to = GetSelectedAddresses();

      params.composeFields = composeFields;
      MailServices.compose.OpenComposeWindowWithParams(null, params);
    }
  }
}

/**
 * Set up items in the View > Layout menupopup.  This function is responsible
 * for updating the menu items' state to reflect reality.
 *
 * @param event the event that caused the View > Layout menupopup to be shown
 */
function InitViewLayoutMenuPopup(event) {
  let dirPaneMenuItem = document.getElementById("menu_showDirectoryPane");
  dirPaneMenuItem.setAttribute("checked", document.getElementById(
    "dirTree-splitter").getAttribute("state") != "collapsed");

  let cardPaneMenuItem = document.getElementById("menu_showCardPane");
  cardPaneMenuItem.setAttribute("checked", document.getElementById(
    "results-splitter").getAttribute("state") != "collapsed");
}

// Generate a list of cards from the selected mailing list
// and get a comma separated list of card addresses. If the
// item selected in the directory pane is not a mailing list,
// an empty string is returned.
function GetSelectedAddressesFromDirTree()
{
  var addresses = "";

  if (gDirTree.currentIndex >= 0) {
    var directory = gDirectoryTreeView.getDirectoryAtIndex(gDirTree.currentIndex);
    if (directory.isMailList) {
      var listCardsCount = directory.addressLists.length;
      var cards = new Array(listCardsCount);
      for (var i = 0; i < listCardsCount; ++i)
        cards[i] = directory.addressLists
                            .queryElementAt(i, Components.interfaces.nsIAbCard);
      addresses = GetAddressesForCards(cards);
    }
  }
  return addresses;
}

// Generate a comma separated list of addresses from a given set of
// cards.
function GetAddressesForCards(cards)
{
  var addresses = "";

  if (!cards) {
    Components.utils.reportError("GetAddressesForCards: |cards| is null.");
    return addresses;
  }

  var count = cards.length;

  // We do not handle the case where there is one or more null-ish
  // element in the Array.  Always non-null element is pushed into
  // cards[] array.

  let generatedAddresses = cards.map(GenerateAddressFromCard)
    .filter(function(aAddress) {
      return aAddress;
    });
  return generatedAddresses.join(',');
}

function SelectFirstAddressBook()
{
  if (gDirTree.view.selection.currentIndex != 0) {
    gDirTree.view.selection.select(0);
    // If gPreviousDirTreeIndex == 0 then DirPaneSelectionChange() and
    // ChangeDirectoryByURI() have already been run
    // (e.g. by the onselect event on the tree) so skip the call.
    if (gPreviousDirTreeIndex != 0)
      ChangeDirectoryByURI(GetSelectedDirectory());
  }
  gAbResultsTree.focus();
}

function DirPaneClick(event)
{
  // we only care about left button events
  if (event.button != 0)
    return;

  // if the user clicks on the header / trecol, do nothing
  if (event.originalTarget.localName == "treecol") {
    event.stopPropagation();
    return;
  }
}

function DirPaneDoubleClick(event)
{
  // we only care about left button events
  if (event.button != 0)
    return;

  var row = gDirTree.treeBoxObject.getRowAt(event.clientX, event.clientY);
  if (row == -1 || row > gDirTree.view.rowCount-1) {
    // double clicking on a non valid row should not open the dir properties dialog
    return;
  }

  if (gDirTree && gDirTree.view.selection && gDirTree.view.selection.count == 1)
    AbEditSelectedDirectory();
}

function DirPaneSelectionChange()
{
  let uri = GetSelectedDirectory();
  // clear out the search box when changing folders...
  onAbClearSearch(false);
  if (gDirTree && gDirTree.view.selection && gDirTree.view.selection.count == 1) {
    gPreviousDirTreeIndex = gDirTree.currentIndex;
    ChangeDirectoryByURI(uri);
    document.getElementById("localResultsOnlyMessage")
            .setAttribute("hidden",
                          !gDirectoryTreeView.hasRemoteAB ||
                          uri != kAllDirectoryRoot + "?");
  }

  goUpdateCommand('cmd_newlist');
  goUpdateCommand('cmd_newCard');
}

function ChangeDirectoryByURI(uri = kPersonalAddressbookURI)
{
  SetAbView(uri);

  // Actively de-selecting if there are any pre-existing selections
  // in the results list.
  if (gAbView && gAbView.getCardFromRow(0))
    gAbView.selection.clearSelection();
  else
    // the selection changes if we were switching directories.
    ResultsPaneSelectionChanged()
}

function AbNewList()
{
  goNewListDialog(GetSelectedDirectory());
}

function goNewListDialog(selectedAB)
{
  window.openDialog("chrome://messenger/content/addressbook/abMailListDialog.xul",
                    "",
                    "chrome,modal,resizable=no,centerscreen",
                    {selectedAB:selectedAB});
}

function goEditListDialog(abCard, listURI)
{
  let params = {
    abCard: abCard,
    listURI: listURI,
    refresh: false, // This is an out param, true if OK in dialog is clicked.
  };
  window.openDialog("chrome://messenger/content/addressbook/abEditListDialog.xul",
                    "",
                    "chrome,modal,resizable=no,centerscreen",
                    params);
  if (params.refresh) {
    ChangeDirectoryByURI(listURI); // force refresh
  }
}

function goNewCardDialog(selectedAB)
{
  window.openDialog("chrome://messenger/content/addressbook/abNewCardDialog.xul",
                    "",
                    "chrome,modal,resizable=no,centerscreen",
                    {selectedAB:selectedAB});
}

function goEditCardDialog(abURI, card)
{
  window.openDialog("chrome://messenger/content/addressbook/abEditCardDialog.xul",
                    "",
                    "chrome,modal,resizable=no,centerscreen",
                    {abURI:abURI, card:card});
}


function setSortByMenuItemCheckState(id, value)
{
    var menuitem = document.getElementById(id);
    if (menuitem) {
      menuitem.setAttribute("checked", value);
    }
}

function InitViewSortByMenu()
{
    var sortColumn = kDefaultSortColumn;
    var sortDirection = kDefaultAscending;

    if (gAbView) {
      sortColumn = gAbView.sortColumn;
      sortDirection = gAbView.sortDirection;
    }

    // this approach is necessary to support generic columns that get overlayed.
    let elements = document.querySelectorAll('[name="sortas"]');
    for (let i = 0; i < elements.length; i++) {
      let cmd = elements[i].id;
      let columnForCmd = cmd.substr(10); // everything right of cmd_SortBy
      setSortByMenuItemCheckState(cmd, (sortColumn == columnForCmd));
    }

    setSortByMenuItemCheckState("sortAscending", (sortDirection == kDefaultAscending));
    setSortByMenuItemCheckState("sortDescending", (sortDirection == kDefaultDescending));
}

function GenerateAddressFromCard(card)
{
  if (!card)
    return "";

  var email;

  if (card.isMailList)
  {
    var directory = GetDirectoryFromURI(card.mailListURI);
    email = directory.description || card.displayName;
  }
  else
    email = card.primaryEmail;

  return MailServices.headerParser.makeMimeAddress(card.displayName, email);
}

function GetDirectoryFromURI(uri)
{
  return MailServices.ab.getDirectory(uri);
}

// returns null if abURI is not a mailing list URI
function GetParentDirectoryFromMailingListURI(abURI)
{
  var abURIArr = abURI.split("/");
  /*
   turn turn "moz-abmdbdirectory://abook.mab/MailList6"
   into ["moz-abmdbdirectory:","","abook.mab","MailList6"]
   then, turn ["moz-abmdbdirectory:","","abook.mab","MailList6"]
   into "moz-abmdbdirectory://abook.mab"
  */
  if (abURIArr.length == 4 && abURIArr[0] == "moz-abmdbdirectory:" && abURIArr[3] != "") {
    return abURIArr[0] + "/" + abURIArr[1] + "/" + abURIArr[2];
  }

  return null;
}

function DirPaneHasFocus()
{
  // returns true if diectory pane has the focus. Returns false, otherwise.
  return (top.document.commandDispatcher.focusedElement == gDirTree)
}

function GetSelectedDirectory()
{
  if (abList)
    return abList.value;
  else {
    if (gDirTree.currentIndex < 0)
      return null;
    return gDirectoryTreeView.getDirectoryAtIndex(gDirTree.currentIndex).URI;
  }
}

/**
 * Clears the contents of the search input field,
 * possibly causing refresh of results.
 *
 * @param aRefresh  Set to false if the refresh isn't needed,
 *                  e.g. window/AB is going away so user will not see anything.
 */
function onAbClearSearch(aRefresh = true)
{
  let searchInput = document.getElementById("peopleSearchInput");
  if (!searchInput || !searchInput.value)
    return;

  searchInput.value = "";
  if (aRefresh)
    onEnterInSearchBar();
}

// sets focus into the quick search box
function QuickSearchFocus()
{
  var searchInput = document.getElementById("peopleSearchInput");
  if (searchInput) {
    searchInput.focus();
    searchInput.select();
  }
}

/**
 * Returns an nsIFile of the directory in which contact photos are stored.
 * This will create the directory if it does not yet exist.
 */
function getPhotosDir() {
  let file = Services.dirsvc.get("ProfD", Components.interfaces.nsIFile);
  // Get the Photos directory
  file.append("Photos");
  if (!file.exists() || !file.isDirectory())
    file.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, PERMS_DIRECTORY);
  return file;
}

/**
 * Returns a URI specifying the location of a photo based on its name.
 * If the name is blank, or if the photo with that name is not in the Photos
 * directory then the default photo URI is returned.
 *
 * @param aPhotoName The name of the photo from the Photos folder, if any.
 *
 * @return A URI pointing to a photo.
 */
function getPhotoURI(aPhotoName) {
  if (!aPhotoName)
    return defaultPhotoURI;
  var file = getPhotosDir();
  try {
    file.append(aPhotoName);
  }
  catch (e) {
    return defaultPhotoURI;
  }
  if (!file.exists())
    return defaultPhotoURI;
  return Services.io.newFileURI(file).spec;
}

/**
 * Copies the photo at the given URI in a folder named "Photos" in the current
 * profile folder.
 * The filename is randomly generated and is unique.
 * The URI is used to obtain a channel which is then opened synchronously and
 * this stream is written to the new file to store an offline, local copy of the
 * photo.
 *
 * @param aUri The URI of the photo.
 *
 * @return An nsIFile representation of the photo.
 */
function storePhoto(aUri)
{
  if (!aUri)
    return false;

  // Get the photos directory and check that it exists
  let file = getPhotosDir();

  // Create a channel from the URI and open it as an input stream
  let channel = Services.io.newChannelFromURI2(Services.io.newURI(aUri, null, null),
                                               null,
                                               Services.scriptSecurityManager.getSystemPrincipal(),
                                               null,
                                               Components.interfaces.nsILoadInfo.SEC_NORMAL,
                                               Components.interfaces.nsIContentPolicy.TYPE_OTHER);
  let istream = channel.open();

  // Get the photo file
  file = makePhotoFile(file, findPhotoExt(channel));

  return IOUtils.saveStreamToFile(istream, file);
}

/**
 * Finds the file extension of the photo identified by the URI, if possible.
 * This function can be overridden (with a copy of the original) for URIs that
 * do not identify the extension or when the Content-Type response header is
 * either not set or isn't 'image/png', 'image/jpeg', or 'image/gif'.
 * The original function can be called if the URI does not match.
 *
 * @param aUri The URI of the photo.
 * @param aChannel The opened channel for the URI.
 *
 * @return The extension of the file, if any, including the period.
 */
function findPhotoExt(aChannel) {
  var mimeSvc = Components.classes["@mozilla.org/mime;1"]
                          .getService(Components.interfaces.nsIMIMEService);
  var ext = "";
  var uri = aChannel.URI;
  if (uri instanceof Components.interfaces.nsIURL)
    ext = uri.fileExtension;
  try {
    return mimeSvc.getPrimaryExtension(aChannel.contentType, ext);
  } catch (e) {}
  return ext;
}

/**
 * Generates a unique filename to be used for a local copy of a contact's photo.
 *
 * @param aPath      The path to the folder in which the photo will be saved.
 * @param aExtension The file extension of the photo.
 *
 * @return A unique filename in the given path.
 */
function makePhotoFile(aDir, aExtension) {
  var filename, newFile;
  // Find a random filename for the photo that doesn't exist yet
  do {
    filename = new String(Math.random()).replace("0.", "") + "." + aExtension;
    newFile = aDir.clone();
    newFile.append(filename);
  } while (newFile.exists());
  return newFile;
}

/**
 * Validates the given year and returns it, if it looks sane.
 * Returns kDefaultYear (a leap year), if no valid date is given.
 * This ensures that month/day calculations still work.
 */
function saneBirthYear(aYear) {
  return aYear && (aYear <= kMaxYear) && (aYear >= kMinYear) ? aYear : kDefaultYear;
}

/**
 * Returns the nearest leap year before aYear.
 */
function nearestLeap(aYear) {
  for (let year = aYear; year > 0; year--) {
    if (new Date(year, 1, 29).getMonth() == 1)
      return year;
  }

  return 2000;
}
