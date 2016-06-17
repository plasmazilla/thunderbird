/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Commands for the message composition window.
 */

// Ensure the activity modules are loaded for this window.
Components.utils.import("resource:///modules/activity/activityModules.js");
Components.utils.import("resource:///modules/attachmentChecker.js");
Components.utils.import("resource:///modules/cloudFileAccounts.js");
Components.utils.import("resource:///modules/errUtils.js");
Components.utils.import("resource:///modules/folderUtils.jsm");
Components.utils.import("resource:///modules/iteratorUtils.jsm");
Components.utils.import("resource:///modules/mailServices.js");
Components.utils.import("resource:///modules/MailUtils.js");
Components.utils.import("resource://gre/modules/InlineSpellChecker.jsm");
Components.utils.import("resource://gre/modules/PluralForm.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

/**
 * interfaces
 */
var nsIMsgCompDeliverMode = Components.interfaces.nsIMsgCompDeliverMode;
var nsIMsgCompSendFormat = Components.interfaces.nsIMsgCompSendFormat;
var nsIMsgCompConvertible = Components.interfaces.nsIMsgCompConvertible;
var nsIMsgCompType = Components.interfaces.nsIMsgCompType;
var nsIMsgCompFormat = Components.interfaces.nsIMsgCompFormat;
var nsIAbPreferMailFormat = Components.interfaces.nsIAbPreferMailFormat;
var nsIPlaintextEditorMail = Components.interfaces.nsIPlaintextEditor;
var nsISupportsString = Components.interfaces.nsISupportsString;
var mozISpellCheckingEngine = Components.interfaces.mozISpellCheckingEngine;

var sDictCount = 0;

/**
 * Global message window object. This is used by mail-offline.js and therefore
 * should not be renamed. We need to avoid doing this kind of cross file global
 * stuff in the future and instead pass this object as parameter when needed by
 * functions in the other js file.
 */
var msgWindow;

var gMessenger;

var gSpellChecker = new InlineSpellChecker();

/**
 * Global variables, need to be re-initialized every time mostly because
 * we need to release them when the window closes.
 */
var gHideMenus;
var gMsgCompose;
var gWindowLocked;
var gSendLocked;
var gContentChanged;
var gSubjectChanged;
var gAutoSaving;
var gCurrentIdentity;
var defaultSaveOperation;
var gSendOperationInProgress;
var gSaveOperationInProgress;
var gCloseWindowAfterSave;
var gSavedSendNowKey;
var gSendFormat;

var gMsgIdentityElement;
var gMsgAddressingWidgetTreeElement;
var gMsgSubjectElement;
var gMsgAttachmentElement;
var gMsgHeadersToolbarElement;
var gManualAttachmentReminder;
var gComposeType;
var gLanguageObserver;

// i18n globals
var gCharsetConvertManager;
var _gComposeBundle;
function getComposeBundle() {
  // That one has to be lazy. Getting a reference to an element with a XBL
  // binding attached will cause the XBL constructors to fire if they haven't
  // already. If we get a reference to the compose bundle at script load-time,
  // this will cause the XBL constructor that's responsible for the personas to
  // fire up, thus executing the personas code while the DOM is not fully built.
  // Since this <script> comes before the <statusbar>, the Personas code will
  // fail.
  if (!_gComposeBundle)
    _gComposeBundle = document.getElementById("bundle_composeMsgs");
  return _gComposeBundle;
}

var gLastWindowToHaveFocus;
var gReceiptOptionChanged;
var gDSNOptionChanged;
var gAttachVCardOptionChanged;

var gAutoSaveInterval;
var gAutoSaveTimeout;
var gAutoSaveKickedIn;
var gEditingDraft;
var gAttachmentsSize;
var gNumUploadingAttachments;

var kComposeAttachDirPrefName = "mail.compose.attach.dir";

function InitializeGlobalVariables()
{
  gMessenger = Components.classes["@mozilla.org/messenger;1"]
                         .createInstance(Components.interfaces.nsIMessenger);

  gMsgCompose = null;
  gWindowLocked = false;
  gContentChanged = false;
  gSubjectChanged = false;
  gCurrentIdentity = null;
  defaultSaveOperation = "draft";
  gSendOperationInProgress = false;
  gSaveOperationInProgress = false;
  gAutoSaving = false;
  gCloseWindowAfterSave = false;
  gSavedSendNowKey = null;
  gSendFormat = nsIMsgCompSendFormat.AskUser;
  gCharsetConvertManager = Components.classes['@mozilla.org/charset-converter-manager;1'].getService(Components.interfaces.nsICharsetConverterManager);
  gHideMenus = false;
  gManualAttachmentReminder = false;
  gLanguageObserver = null;

  gLastWindowToHaveFocus = null;
  gReceiptOptionChanged = false;
  gDSNOptionChanged = false;
  gAttachVCardOptionChanged = false;
  gAttachmentsSize = 0;
  gNumUploadingAttachments = 0;
  msgWindow = Components.classes["@mozilla.org/messenger/msgwindow;1"]
                        .createInstance(Components.interfaces.nsIMsgWindow);
  MailServices.mailSession.AddMsgWindow(msgWindow);
}
InitializeGlobalVariables();

function ReleaseGlobalVariables()
{
  gCurrentIdentity = null;
  gCharsetConvertManager = null;
  gMsgCompose = null;
  gMessenger = null;
  _gComposeBundle = null;
  MailServices.mailSession.RemoveMsgWindow(msgWindow);
  msgWindow = null;
}

/**
 * Disables or enables editable elements in the window.
 * The elements to operate on are marked with the "disableonsend" attribute.
 * This includes elements like the address list, attachment list, subject
 * and message body.
 *
 * @param aDisable  true = disable items. false = enable items.
 */
function updateEditableFields(aDisable)
{
  if (!gMsgCompose)
    return;

  if (aDisable)
    gMsgCompose.editor.flags |= nsIPlaintextEditorMail.eEditorReadonlyMask;
  else
    gMsgCompose.editor.flags &= ~nsIPlaintextEditorMail.eEditorReadonlyMask;

  let elements = document.querySelectorAll('[disableonsend="true"]');
  for (let i = 0; i < elements.length; i++)
    elements[i].disabled = aDisable;
}

var gComposeRecyclingListener = {
  onClose: function() {
    //Clear the subject
    GetMsgSubjectElement().value = "";
    // be sure to clear the transaction manager for the subject
    GetMsgSubjectElement().editor.transactionManager.clear();
    SetComposeWindowTitle();

    //Reset recipients and attachments
    awResetAllRows();
    RemoveAllAttachments();

    // We need to clear the identity popup menu in case the user will change them.
    // It will be rebuilt later in ComposeStartup
    ClearIdentityListPopup(document.getElementById("msgIdentityPopup"));
    var identityElement = document.getElementById("msgIdentity");
    identityElement.editable = false;
    identityElement.setAttribute("type", "description");
    var customizeMenuitem = document.getElementById("cmd_customizeFromAddress");
    customizeMenuitem.removeAttribute("disabled");
    customizeMenuitem.setAttribute("checked", "false");

    // Do not listen to changes to spell check dictionary.
    document.removeEventListener("spellcheck-changed", updateDocumentLanguage);

    // Disconnect the observer, we'll attach a new one when recycling the
    // window.
    gLanguageObserver.disconnect();

    // Stop observing dictionary removals.
    dictionaryRemovalObserver.removeObserver();

    // Stop gSpellChecker so personal dictionary is saved.
    // We need to do this before disabling the editor.
    enableInlineSpellCheck(false);
    // clear any suggestions in the context menu
    gSpellChecker.clearSuggestionsFromMenu();
    gSpellChecker.clearDictionaryListFromMenu();

    SetContentAndBodyAsUnmodified();
    updateEditableFields(true);

    // Clear the focus
    awGetInputElement(1).removeAttribute('focused');

    //Reset Boxes size
    document.getElementById("headers-box").removeAttribute("height");
    document.getElementById("appcontent").removeAttribute("height");
    document.getElementById("addresses-box").removeAttribute("width");

    //Reset menu options
    document.getElementById("format_auto").setAttribute("checked", "true");
    document.getElementById("priority_normal").setAttribute("checked", "true");

    //Reset toolbars that could be hidden
    if (gHideMenus) {
      document.getElementById("formatMenu").hidden = false;
      document.getElementById("insertMenu").hidden = false;
      var showFormat = document.getElementById("menu_showFormatToolbar")
      showFormat.hidden = false;
      if (showFormat.getAttribute("checked") == "true")
        document.getElementById("FormatToolbar").hidden = false;
    }

    // Reset the Customize Toolbars panel/sheet if open.
    if (getMailToolbox().customizing && gCustomizeSheet)
      document.getElementById("customizeToolbarSheetIFrame")
              .contentWindow.finishToolbarCustomization();

    //Reset editor
    EditorResetFontAndColorAttributes();
    EditorCleanup();
    gAttachmentNotifier.redetectKeywords();

    //Release the nsIMsgComposeParams object
    if (window.arguments && window.arguments[0])
      window.arguments[0] = null;
    document.getElementById("msgcomposeWindow").dispatchEvent(
      new Event("compose-window-close", { bubbles: false , cancelable: true }));
    if (gAutoSaveTimeout)
      clearTimeout(gAutoSaveTimeout);
    ReleaseGlobalVariables(); 	// This line must be the last in onClose();
  },

  onReopen: function(params) {
    InitializeGlobalVariables();
    ComposeStartup(true, params);

    var event = document.createEvent('Events');
    event.initEvent('compose-window-reopen', false, true);
    document.getElementById("msgcomposeWindow").dispatchEvent(event);
  }
};

var PrintPreviewListener = {
  getPrintPreviewBrowser: function() {
    var browser = document.getElementById("cppBrowser");
    if (!browser) {
      browser = document.createElement("browser");
      browser.setAttribute("id", "cppBrowser");
      browser.setAttribute("flex", "1");
      browser.setAttribute("disablehistory", "true");
      browser.setAttribute("type", "content");
      document.getElementById("headers-parent").
        insertBefore(browser, document.getElementById("appcontent"));
    }
    return browser;
  },
  getSourceBrowser: function() {
    return GetCurrentEditorElement();
  },
  getNavToolbox: function() {
    return document.getElementById("compose-toolbox");
  },
  onEnter: function() {
    toggleAffectedChrome(true);
  },
  onExit: function() {
    document.getElementById("cppBrowser").collapsed = true;
    toggleAffectedChrome(false);
  }
}

function sidebar_is_hidden() {
  var sidebar_box = document.getElementById('sidebar-box');
  return sidebar_box.getAttribute('hidden') == 'true';
}

function sidebar_is_collapsed() {
  var sidebar_splitter = document.getElementById('sidebar-splitter');
  return (sidebar_splitter &&
          sidebar_splitter.getAttribute('state') == 'collapsed');
}

function SidebarSetState(aState) {
  document.getElementById("sidebar-box").hidden = aState != "visible";
  document.getElementById("sidebar-splitter").hidden = aState == "hidden";
}

function SidebarGetState() {
  if (sidebar_is_hidden())
    return "hidden";
  if (sidebar_is_collapsed())
    return "collapsed";
  return "visible";
}

function toggleAffectedChrome(aHide)
{
  // chrome to toggle includes:
  //   (*) menubar
  //   (*) toolbox
  //   (*) sidebar
  //   (*) statusbar
  if (!gChromeState)
    gChromeState = new Object;

  var statusbar = document.getElementById("status-bar");

  // sidebar states map as follows:
  //   hidden    => hide/show nothing
  //   collapsed => hide/show only the splitter
  //   shown     => hide/show the splitter and the box
  if (aHide)
  {
    // going into print preview mode
    document.getElementById("headers-box").hidden = true;
    gChromeState.sidebar = SidebarGetState();
    let subject = document.getElementById("msgSubject").value;
    if (subject)
      document.title = subject;
    SidebarSetState("hidden");

    // deal with the Status Bar
    gChromeState.statusbarWasHidden = statusbar.hidden;
    statusbar.hidden = true;
  }
  else
  {
    // restoring normal mode (i.e., leaving print preview mode)
    SetComposeWindowTitle();
    SidebarSetState(gChromeState.sidebar);
    document.getElementById("headers-box").hidden = false;

    // restore the Status Bar
    statusbar.hidden = gChromeState.statusbarWasHidden;
  }

  document.getElementById("compose-toolbox").hidden = aHide;
  document.getElementById("appcontent").collapsed = aHide;
}

var stateListener = {
  NotifyComposeFieldsReady: function() {
    ComposeFieldsReady();
    updateSendCommands(true);
  },

  NotifyComposeBodyReady: function() {
    if (gMsgCompose.composeHTML)
      loadHTMLMsgPrefs();
    AdjustFocus();
  },

  ComposeProcessDone: function(aResult) {
    ToggleWindowLock(false);

    if (aResult== Components.results.NS_OK)
    {
      if (!gAutoSaving)
        SetContentAndBodyAsUnmodified();

      if (gCloseWindowAfterSave)
      {
        // Notify the SendListener that Send has been aborted and Stopped
        if (gMsgCompose)
          gMsgCompose.onSendNotPerformed(null, Components.results.NS_ERROR_ABORT);

        MsgComposeCloseWindow(true);
      }
    }
    // else if we failed to save, and we're autosaving, need to re-mark the editor
    // as changed, so that we won't lose the changes.
    else if (gAutoSaving)
    {
      gMsgCompose.bodyModified = true;
      gContentChanged = true;
    }
    gAutoSaving = false;
    gCloseWindowAfterSave = false;
  },

  SaveInFolderDone: function(folderURI) {
    DisplaySaveFolderDlg(folderURI);
  }
};

var gSendListener = {
  // nsIMsgSendListener
  onStartSending: function (aMsgID, aMsgSize) {},
  onProgress: function (aMsgID, aProgress, aProgressMax) {},
  onStatus: function (aMsgID, aMsg) {},
  onStopSending: function (aMsgID, aStatus, aMsg, aReturnFile) {
    if (Components.isSuccessCode(aStatus))
      Services.obs.notifyObservers(null, "mail:composeSendSucceeded", null);
  },
  onGetDraftFolderURI: function (aFolderURI) {},
  onSendNotPerformed: function (aMsgID, aStatus) {},
};

// all progress notifications are done through the nsIWebProgressListener implementation...
var progressListener = {
    onStateChange: function(aWebProgress, aRequest, aStateFlags, aStatus)
    {
      if (aStateFlags & Components.interfaces.nsIWebProgressListener.STATE_START)
      {
        document.getElementById('compose-progressmeter').setAttribute( "mode", "undetermined" );
        document.getElementById("statusbar-progresspanel").collapsed = false;
      }

      if (aStateFlags & Components.interfaces.nsIWebProgressListener.STATE_STOP)
      {
        gSendOperationInProgress = false;
        gSaveOperationInProgress = false;
        document.getElementById('compose-progressmeter').setAttribute( "mode", "normal" );
        document.getElementById('compose-progressmeter').setAttribute( "value", 0 );
        document.getElementById("statusbar-progresspanel").collapsed = true;
        document.getElementById('statusText').setAttribute('label', '');
      }
    },

    onProgressChange: function(aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress)
    {
      // Calculate percentage.
      var percent;
      if ( aMaxTotalProgress > 0 )
      {
        percent = Math.round( (aCurTotalProgress*100)/aMaxTotalProgress );
        if ( percent > 100 )
          percent = 100;

        document.getElementById('compose-progressmeter').removeAttribute("mode");

        // Advance progress meter.
        document.getElementById('compose-progressmeter').setAttribute( "value", percent );
      }
      else
      {
        // Progress meter should be barber-pole in this case.
        document.getElementById('compose-progressmeter').setAttribute( "mode", "undetermined" );
      }
    },

    onLocationChange: function(aWebProgress, aRequest, aLocation, aFlags)
    {
      // we can ignore this notification
    },

    onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage)
    {
      // Looks like it's possible that we get call while the document has been already delete!
      // therefore we need to protect ourself by using try/catch
      try {
        let statusText = document.getElementById("statusText");
        if (statusText)
          statusText.setAttribute("label", aMessage);
      } catch (ex) {}
    },

    onSecurityChange: function(aWebProgress, aRequest, state)
    {
      // we can ignore this notification
    },

    QueryInterface : function(iid)
    {
      if (iid.equals(Components.interfaces.nsIWebProgressListener) ||
          iid.equals(Components.interfaces.nsISupportsWeakReference) ||
          iid.equals(Components.interfaces.nsISupports))
        return this;

      throw Components.results.NS_NOINTERFACE;
    }
};

var defaultController = {
  commands: {
    cmd_attachFile: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        AttachFile();
      }
    },

    cmd_attachCloud: {
      isEnabled: function() {
        // Hide the command entirely if there are no cloud accounts or
        // the feature is disbled.
        let cmd = document.getElementById("cmd_attachCloud");
        cmd.hidden = !Services.prefs.getBoolPref("mail.cloud_files.enabled") ||
                     (cloudFileAccounts.accounts.length == 0) ||
                     Services.io.offline;
        return !cmd.hidden && !gWindowLocked;
      },
      doCommand: function() {
        // We should never actually call this, since the <command> node calls
        // a different function.
      }
    },

    cmd_attachPage: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        AttachPage();
      }
    },

    cmd_close: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        DoCommandClose();
      }
    },

    cmd_saveDefault: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        Save();
      }
    },

    cmd_saveAsFile: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        SaveAsFile(true);
      }
    },

    cmd_saveAsDraft: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        SaveAsDraft();
      }
    },

    cmd_saveAsTemplate: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        SaveAsTemplate();
      }
    },

    cmd_sendButton: {
      isEnabled: function() {
        return !gWindowLocked && !gNumUploadingAttachments && !gSendLocked;
      },
      doCommand: function() {
        if (Services.io.offline)
          SendMessageLater();
        else
          SendMessage();
      }
    },

    cmd_sendNow: {
      isEnabled: function() {
        return !gWindowLocked && !Services.io.offline && !gSendLocked &&
               !gNumUploadingAttachments;
      },
      doCommand: function() {
        SendMessage();
      }
    },

    cmd_sendLater: {
      isEnabled: function() {
        return !gWindowLocked && !gNumUploadingAttachments && !gSendLocked;
      },
      doCommand: function() {
        SendMessageLater();
      }
    },

    cmd_sendWithCheck: {
      isEnabled: function() {
        return !gWindowLocked && !gNumUploadingAttachments && !gSendLocked;
      },
      doCommand: function() {
        SendMessageWithCheck();
      }
    },

    cmd_printSetup: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        PrintUtils.showPageSetup();
      }
    },

    cmd_print: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        DoCommandPrint();
      }
    },

    cmd_printPreview: {
      isEnabled: function() {
        return !gWindowLocked;
      },
      doCommand: function() {
        DoCommandPrintPreview();
      }
    },

    cmd_delete: {
      isEnabled: function() {
        let cmdDelete = document.getElementById("cmd_delete");
        let textValue = cmdDelete.getAttribute("valueDefault");
        let accesskeyValue = cmdDelete.getAttribute("valueDefaultAccessKey");

        cmdDelete.setAttribute("label", textValue);
        cmdDelete.setAttribute("accesskey", accesskeyValue);

        return false;
      },
      doCommand: function() {
      }
    },

    cmd_account: {
      isEnabled: function() {
        return true;
      },
      doCommand: function() {
        let currentAccountKey = getCurrentAccountKey();
        let account = MailServices.accounts.getAccount(currentAccountKey);
        MsgAccountManager(null, account.incomingServer);
      }
    },

    cmd_showFormatToolbar: {
      isEnabled: function() {
        return gMsgCompose && gMsgCompose.composeHTML;
      },
      doCommand: function() {
        goToggleToolbar("FormatToolbar", "menu_showFormatToolbar");
      }
    },

    cmd_quoteMessage: {
      isEnabled: function() {
        let selectedURIs = GetSelectedMessages();
        return (selectedURIs && selectedURIs.length > 0)
      },
      doCommand: function() {
        QuoteSelectedMessage();
      }
    },

    cmd_fullZoomReduce: {
      isEnabled: function () {
        return true;
      },
      doCommand: function() {
        ZoomManager.reduce();
      }
    },

    cmd_fullZoomEnlarge: {
      isEnabled: function () {
        return true;
      },
      doCommand: function() {
        ZoomManager.enlarge();
      }
    },

    cmd_fullZoomReset: {
      isEnabled: function () {
        return true;
      },
      doCommand: function() {
        ZoomManager.reset();
      }
    },

    cmd_spelling: {
      isEnabled: function() {
        return true;
      },
      doCommand: function() {
        window.cancelSendMessage = false;
        var skipBlockQuotes =
          (window.document.documentElement.getAttribute("windowtype") ==
          "msgcompose");
        window.openDialog("chrome://editor/content/EdSpellCheck.xul", "_blank",
                          "dialog,close,titlebar,modal,resizable",
                          false, skipBlockQuotes, true);
      }
    },

    cmd_fullZoomToggle: {
      isEnabled: function () {
        return true;
      },
      doCommand: function() {
        ZoomManager.toggleZoom();
      }
    },
  },

  supportsCommand: function(aCommand) {
    return (aCommand in this.commands);
  },

  isCommandEnabled: function(aCommand) {
    if (!this.supportsCommand(aCommand))
      return false;
    return this.commands[aCommand].isEnabled();
  },

  doCommand: function(aCommand) {
    if (!this.supportsCommand(aCommand))
      return;
    var cmd = this.commands[aCommand];
    if (!cmd.isEnabled())
      return;
    cmd.doCommand();
  },

  onEvent: function(event) {},
};

var attachmentBucketController = {
  commands: {
    cmd_selectAll: {
      isEnabled: function() {
        return true;
      },
      doCommand: function() {
        document.getElementById("attachmentBucket").selectAll();
      }
    },

    cmd_delete: {
      isEnabled: function() {
        let selectedCount = MessageGetNumSelectedAttachments();
        let cmdDelete = document.getElementById("cmd_delete");
        let textValue = getComposeBundle().getString("removeAttachmentMsgs");
        textValue = PluralForm.get(selectedCount, textValue);
        let accesskeyValue = cmdDelete.getAttribute("valueRemoveAttachmentAccessKey");
        cmdDelete.setAttribute("label", textValue);
        cmdDelete.setAttribute("accesskey", accesskeyValue);

        return selectedCount > 0;
      },
      doCommand: function() {
        RemoveSelectedAttachment();
      }
    },

    cmd_openAttachment: {
      isEnabled: function() {
        return MessageGetNumSelectedAttachments() == 1;
      },
      doCommand: function() {
        OpenSelectedAttachment();
      }
    },

    cmd_renameAttachment: {
      isEnabled: function() {
        return MessageGetNumSelectedAttachments() == 1;
      },
      doCommand: function() {
        RenameSelectedAttachment();
      }
    },

    cmd_convertCloud: {
      isEnabled: function() {
        // Hide the command entirely if Filelink is disabled, or if there are
        // no cloud accounts.
        let cmd = document.getElementById("cmd_convertCloud");

        cmd.hidden = (!Services.prefs.getBoolPref("mail.cloud_files.enabled") ||
                      cloudFileAccounts.accounts.length == 0) ||
                      Services.io.offline;
        if (cmd.hidden)
          return false;

        let bucket = document.getElementById("attachmentBucket");
        for (let item of bucket.selectedItems) {
          if (item.uploading)
            return false;
        }
        return true;
      },
      doCommand: function() {
        // We should never actually call this, since the <command> node calls
        // a different function.
      }
    },

    cmd_convertAttachment: {
      isEnabled: function() {
        if (!Services.prefs.getBoolPref("mail.cloud_files.enabled"))
          return false;

        let bucket = document.getElementById("attachmentBucket");
        for (let item of bucket.selectedItems) {
          if (item.uploading)
            return false;
        }
        return true;
      },
      doCommand: function() {
        convertSelectedToRegularAttachment();
      }
    },

    cmd_cancelUpload: {
      isEnabled: function() {
        let cmd = document.getElementById("composeAttachmentContext_cancelUploadItem");

        // If Filelink is disabled, hide this menuitem and bailout.
        if (!Services.prefs.getBoolPref("mail.cloud_files.enabled")) {
          cmd.hidden = true;
          return false;
        }

        let bucket = document.getElementById("attachmentBucket");
        for (let item of bucket.selectedItems) {
          if (item && item.uploading) {
            cmd.hidden = false;
            return true;
          }
        }

        // Hide the command entirely if the selected attachments aren't cloud
        // files.
        // For some reason, the hidden property isn't propagating from the cmd
        // to the menuitem.
        cmd.hidden = true;
        return false;
      },
      doCommand: function() {
        let fileHandler = Services.io.getProtocolHandler("file")
                                  .QueryInterface(Components.interfaces.nsIFileProtocolHandler);

        let bucket = document.getElementById("attachmentBucket");
        for (let item of bucket.selectedItems) {
          if (item && item.uploading) {
            let file = fileHandler.getFileFromURLSpec(item.attachment.url);
            item.cloudProvider.cancelFileUpload(file);
          }
        }
      },
    },
  },

  supportsCommand: function(aCommand) {
    return (aCommand in this.commands);
  },

  isCommandEnabled: function(aCommand) {
    if (!this.supportsCommand(aCommand))
      return false;
    return this.commands[aCommand].isEnabled();
  },

  doCommand: function(aCommand) {
    if (!this.supportsCommand(aCommand))
      return;
    var cmd = this.commands[aCommand];
    if (!cmd.isEnabled())
      return;
    cmd.doCommand();
  },

  onEvent: function(event) {},
};

/**
 * Start composing a new message.
 */
function goOpenNewMessage(aEvent)
{
  // If aEvent is passed, check if Shift key was pressed for composition in
  // non-default format (HTML vs. plaintext).
  let msgCompFormat = (aEvent && aEvent.shiftKey) ?
    Components.interfaces.nsIMsgCompFormat.OppositeOfDefault :
    Components.interfaces.nsIMsgCompFormat.Default;

  let identity = getCurrentIdentity();
  MailServices.compose.OpenComposeWindow(null, null, null,
    Components.interfaces.nsIMsgCompType.New,
    msgCompFormat, identity, null);
}

function QuoteSelectedMessage()
{
  var selectedURIs = GetSelectedMessages();
  if (selectedURIs)
    for (let i = 0; i < selectedURIs.length; i++)
      gMsgCompose.quoteMessage(selectedURIs[i]);
}

function GetSelectedMessages()
{
  let mailWindow = Services.wm.getMostRecentWindow("mail:3pane");
  return (mailWindow) ? mailWindow.gFolderDisplay.selectedMessageUris : null;
}

function SetupCommandUpdateHandlers()
{
  let attachmentBucket = document.getElementById("attachmentBucket");

  top.controllers.appendController(defaultController);
  attachmentBucket.controllers.appendController(attachmentBucketController);

  document.getElementById("optionsMenuPopup")
          .addEventListener("popupshowing", updateOptionItems, true);
}

function UnloadCommandUpdateHandlers()
{
  let attachmentBucket = document.getElementById("attachmentBucket");

  document.getElementById("optionsMenuPopup")
          .removeEventListener("popupshowing", updateOptionItems, true);

  attachmentBucket.controllers.removeController(attachmentBucketController);
  top.controllers.removeController(defaultController);
}

function CommandUpdate_MsgCompose()
{
  var focusedWindow = top.document.commandDispatcher.focusedWindow;

  // we're just setting focus to where it was before
  if (focusedWindow == gLastWindowToHaveFocus)
    return;

  gLastWindowToHaveFocus = focusedWindow;
  updateComposeItems();
}

function findbarFindReplace()
{
  SetMsgBodyFrameFocus();
  let findbar = document.getElementById("FindToolbar");
  findbar.close();
  goDoCommand("cmd_findReplace");
  findbar.open();
}

function updateComposeItems()
{
  try {
    // Edit Menu
    goUpdateCommand("cmd_rewrap");

    // Insert Menu
    if (gMsgCompose && gMsgCompose.composeHTML)
    {
      goUpdateCommand("cmd_renderedHTMLEnabler");
      goUpdateCommand("cmd_fontColor");
      goUpdateCommand("cmd_backgroundColor");
      goUpdateCommand("cmd_decreaseFontStep");
      goUpdateCommand("cmd_increaseFontStep");
      goUpdateCommand("cmd_bold");
      goUpdateCommand("cmd_italic");
      goUpdateCommand("cmd_underline");
      goUpdateCommand("cmd_ul");
      goUpdateCommand("cmd_ol");
      goUpdateCommand("cmd_indent");
      goUpdateCommand("cmd_outdent");
      goUpdateCommand("cmd_align");
      goUpdateCommand("cmd_smiley");
    }

    // Options Menu
    goUpdateCommand("cmd_spelling");

    // Workaround to update 'Quote' toolbar button. (See bug 609926.)
    goUpdateCommand("cmd_quoteMessage");
  } catch(e) {}
}

/**
 * Disables or restores all toolbar items (menus/buttons) in the window.
 *
 * @param aDisable  true = disable all items. false = restore items to the state
 *                  stored before disabling them.
 */
function updateAllItems(aDisable)
{
  function getDisabledState(aElement) {
    if ("disabled" in aElement)
      return (aElement.disabled ? "true" : "false");
    else if (!aElement.hasAttribute("disabled"))
      return "";
    else
      return aElement.getAttribute("disabled");
  }

  function setDisabledState(aElement, aValue) {
    if ("disabled" in aElement)
      aElement.disabled = (aValue == "true");
    else if (aValue == "")
      aElement.removeAttribute("disabled");
    else
      aElement.setAttribute("disabled", aValue);
  }


  // This array will contain HTMLCollection objects as members.
  let commandItemCollections = [];
  commandItemCollections.push(document.getElementsByTagName("menu"));
  commandItemCollections.push(document.getElementsByTagName("toolbarbutton"));
  commandItemCollections.push(document.querySelectorAll('[command]'));
  commandItemCollections.push(document.querySelectorAll('[oncommand]'));
  for (let itemCollection of commandItemCollections) {
    for (let item = 0; item < itemCollection.length; item++) {
      let commandItem = itemCollection[item];
      if (aDisable) {
        // Any element can appear multiple times in the commandItemCollections
        // list so only act on it if we didn't already set the "stateBeforeSend"
        // attribute on previous visit.
        if (!commandItem.hasAttribute("stateBeforeSend")) {
          commandItem.setAttribute("stateBeforeSend", getDisabledState(commandItem));
          setDisabledState(commandItem, true);
        }
      }
      else {
        // Any element can appear multiple times in the commandItemCollections
        // list so only act on it if it still has the "stateBeforeSend"
        // attribute.
        if (commandItem.hasAttribute("stateBeforeSend")) {
          setDisabledState(commandItem, commandItem.getAttribute("stateBeforeSend"));
          commandItem.removeAttribute("stateBeforeSend");
        }
      }
    }
  }
}

function InitFileSaveAsMenu()
{
  document.getElementById("cmd_saveAsFile")
          .setAttribute("checked", defaultSaveOperation == "file");
  document.getElementById("cmd_saveAsDraft")
          .setAttribute("checked", defaultSaveOperation == "draft");
  document.getElementById("cmd_saveAsTemplate")
          .setAttribute("checked", defaultSaveOperation == "template");
}

function openEditorContextMenu(popup)
{
  gSpellChecker.clearSuggestionsFromMenu();
  gSpellChecker.initFromEvent(document.popupRangeParent, document.popupRangeOffset);
  var onMisspelling = gSpellChecker.overMisspelling;
  document.getElementById('spellCheckSuggestionsSeparator').hidden = !onMisspelling;
  document.getElementById('spellCheckAddToDictionary').hidden = !onMisspelling;
  document.getElementById('spellCheckIgnoreWord').hidden = !onMisspelling;
  var separator = document.getElementById('spellCheckAddSep');
  separator.hidden = !onMisspelling;
  document.getElementById('spellCheckNoSuggestions').hidden = !onMisspelling ||
      gSpellChecker.addSuggestionsToMenu(popup, separator, 5);

  // We ought to do that, otherwise changing dictionaries will have no effect!
  // InlineSpellChecker only registers callbacks for entries that are not the
  // current dictionary, so if we changed dictionaries in the meanwhile, we must
  // rebuild the list so that the right callbacks are registered in the Language
  // menu.
  gSpellChecker.clearDictionaryListFromMenu();
  let dictMenu = document.getElementById("spellCheckDictionariesMenu");
  let dictSep = document.getElementById("spellCheckLanguageSeparator");
  gSpellChecker.addDictionaryListToMenu(dictMenu, dictSep);

  updateEditItems();
}

function updateEditItems()
{
  goUpdateCommand("cmd_paste");
  goUpdateCommand("cmd_pasteNoFormatting");
  goUpdateCommand("cmd_pasteQuote");
  goUpdateCommand("cmd_delete");
  goUpdateCommand("cmd_renameAttachment");
  goUpdateCommand("cmd_selectAll");
  goUpdateCommand("cmd_openAttachment");
  goUpdateCommand("cmd_findReplace");
  goUpdateCommand("cmd_find");
  goUpdateCommand("cmd_findNext");
  goUpdateCommand("cmd_findPrev");
}

function updateAttachmentItems()
{
  goUpdateCommand("cmd_attachCloud");
  goUpdateCommand("cmd_convertCloud");
  goUpdateCommand("cmd_convertAttachment");
  goUpdateCommand("cmd_cancelUpload");
  goUpdateCommand("cmd_delete");
  goUpdateCommand("cmd_renameAttachment");
  goUpdateCommand("cmd_selectAll");
  goUpdateCommand("cmd_openAttachment");
}

/**
 * Update all the commands for sending a message to reflect their current state.
 */
function updateSendCommands(aHaveController)
{
  updateSendLock();
  if (aHaveController) {
    goUpdateCommand("cmd_sendButton");
    goUpdateCommand("cmd_sendNow");
    goUpdateCommand("cmd_sendLater");
    goUpdateCommand("cmd_sendWithCheck");
  } else {
    goSetCommandEnabled("cmd_sendButton",    defaultController.isCommandEnabled("cmd_sendButton"));
    goSetCommandEnabled("cmd_sendNow",       defaultController.isCommandEnabled("cmd_sendNow"));
    goSetCommandEnabled("cmd_sendLater",     defaultController.isCommandEnabled("cmd_sendLater"));
    goSetCommandEnabled("cmd_sendWithCheck", defaultController.isCommandEnabled("cmd_sendWithCheck"));
  }
}

function addAttachCloudMenuItems(aParentMenu)
{
  while (aParentMenu.hasChildNodes())
    aParentMenu.lastChild.remove();

  for (let [,cloudProvider] in Iterator(cloudFileAccounts.accounts)) {
    let item = document.createElement("menuitem");
    let iconClass = cloudProvider.iconClass;
    item.cloudProvider = cloudProvider;
    item.setAttribute("label", cloudFileAccounts.getDisplayName(cloudProvider));

    if (iconClass) {
      item.setAttribute("class", "menu-iconic");
      item.setAttribute("image", iconClass);
    }
    aParentMenu.appendChild(item);
  }
}

function addConvertCloudMenuItems(aParentMenu, aAfterNodeId, aRadioGroup)
{
  let attachment = document.getElementById("attachmentBucket").selectedItem;
  let afterNode = document.getElementById(aAfterNodeId);
  while (afterNode.nextSibling)
    afterNode.nextSibling.remove();

  if (!attachment.sendViaCloud) {
    let item = document.getElementById("convertCloudMenuItems_popup_convertAttachment");
    item.setAttribute("checked", "true");
  }

  for (let [,cloudProvider] in Iterator(cloudFileAccounts.accounts)) {
    let item = document.createElement("menuitem");
    let iconClass = cloudProvider.iconClass;
    item.cloudProvider = cloudProvider;
    item.setAttribute("label", cloudFileAccounts.getDisplayName(cloudProvider));
    item.setAttribute("type", "radio");
    item.setAttribute("name", aRadioGroup);

    if (attachment.cloudProvider &&
        attachment.cloudProvider.accountKey == cloudProvider.accountKey) {
      item.setAttribute("checked", "true");
    }
    else if (iconClass) {
      item.setAttribute("class", "menu-iconic");
      item.setAttribute("image", iconClass);
    }

    aParentMenu.appendChild(item);
  }
}

function uploadListener(aAttachment, aFile, aCloudProvider)
{
  this.attachment = aAttachment;
  this.file = aFile;
  this.cloudProvider = aCloudProvider;

  // Notify the UI that we're starting the upload process: disable send commands
  // and show a "connecting" icon for the attachment.
  this.attachment.sendViaCloud = true;
  gNumUploadingAttachments++;
  updateSendCommands(true);

  let bucket = document.getElementById("attachmentBucket");
  let item = bucket.findItemForAttachment(this.attachment);
  if (item) {
    item.image = "chrome://messenger/skin/icons/connecting.png";
    item.setAttribute("tooltiptext",
      getComposeBundle().getFormattedString("cloudFileUploadingTooltip", [
        cloudFileAccounts.getDisplayName(this.cloudProvider)
      ]));
    item.uploading = true;
    item.cloudProvider = this.cloudProvider;
  }
}

uploadListener.prototype = {
  onStartRequest: function uploadListener_onStartRequest(aRequest, aContext) {
    let bucket = document.getElementById("attachmentBucket");
    let item = bucket.findItemForAttachment(this.attachment);
    if (item)
      item.image = "chrome://messenger/skin/icons/loading.png";
  },

  onStopRequest: function uploadListener_onStopRequest(aRequest, aContext,
                                                       aStatusCode) {
    let bucket = document.getElementById("attachmentBucket");
    let attachmentItem = bucket.findItemForAttachment(this.attachment);

    if (Components.isSuccessCode(aStatusCode)) {
      let originalUrl = this.attachment.url;
      this.attachment.contentLocation = this.cloudProvider.urlForFile(this.file);
      this.attachment.cloudProviderKey = this.cloudProvider.accountKey;
      if (attachmentItem) {
        // Update relevant bits on the attachment list item.
        if (!attachmentItem.originalUrl)
          attachmentItem.originalUrl = originalUrl;
        attachmentItem.setAttribute("tooltiptext",
          getComposeBundle().getFormattedString("cloudFileUploadedTooltip", [
            cloudFileAccounts.getDisplayName(this.cloudProvider)
          ]));
        attachmentItem.uploading = false;

        // Set the icon for the attachment.
        let iconClass = this.cloudProvider.iconClass;
        if (iconClass)
          attachmentItem.image = iconClass;
        else {
          // Should we use a generic "cloud" icon here? Or an overlay icon?
          // I think the provider should provide an icon, end of story.
          attachmentItem.image = null;
        }
      }

      let event = document.createEvent("Events");
      event.initEvent("attachment-uploaded", true, true);
      attachmentItem.dispatchEvent(new Event("attachment-uploaded",
        { bubbles: true, cancelable: true }));
    }
    else {
      let title;
      let msg;
      let displayName = cloudFileAccounts.getDisplayName(this.cloudProvider);
      let bundle = getComposeBundle();
      let displayError = true;
      switch (aStatusCode) {
      case this.cloudProvider.authErr:
        title = bundle.getString("errorCloudFileAuth.title");
        msg = bundle.getFormattedString("errorCloudFileAuth.message",
                                        [displayName]);
        break;
      case this.cloudProvider.uploadErr:
        title = bundle.getString("errorCloudFileUpload.title");
        msg = bundle.getFormattedString("errorCloudFileUpload.message",
                                        [displayName,
                                         this.attachment.name]);
        break;
      case this.cloudProvider.uploadWouldExceedQuota:
        title = bundle.getString("errorCloudFileQuota.title");
        msg = bundle.getFormattedString("errorCloudFileQuota.message",
                                        [displayName,
                                         this.attachment.name]);
        break;
      case this.cloudProvider.uploadExceedsFileNameLimit:
        title = bundle.getString("errorCloudFileNameLimit.title");
        msg = bundle.getFormattedString("errorCloudFileNameLimit.message",
                                        [displayName,
                                         this.attachment.name]);
        break;
      case this.cloudProvider.uploadExceedsFileLimit:
        title = bundle.getString("errorCloudFileLimit.title");
        msg = bundle.getFormattedString("errorCloudFileLimit.message",
                                        [displayName,
                                         this.attachment.name]);
        break;
      case this.cloudProvider.uploadCanceled:
        displayError = false;
        break;
      default:
        title = bundle.getString("errorCloudFileOther.title");
        msg = bundle.getFormattedString("errorCloudFileOther.message",
                                        [displayName]);
        break;
      }

      // TODO: support actions other than "Upgrade"
      if (displayError) {
        let url = this.cloudProvider.providerUrlForError(aStatusCode);
        let flags = Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_OK;
        if (url)
          flags += Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_IS_STRING;
        if (Services.prompt.confirmEx(window, title, msg, flags, null,
                                      bundle.getString("errorCloudFileUpgrade.label"),
                                      null, null, {})) {
          openLinkExternally(url);
        }
      }

      if (attachmentItem) {
        // Remove the loading throbber.
        attachmentItem.image = null;
        attachmentItem.setAttribute("tooltiptext", attachmentItem.attachment.url);
        attachmentItem.uploading = false;
        attachmentItem.attachment.sendViaCloud = false;
        delete attachmentItem.cloudProvider;

        let event = document.createEvent("CustomEvent");
        event.initEvent("attachment-upload-failed", true, true,
                        aStatusCode);
        attachmentItem.dispatchEvent(event);
      }
    }

    gNumUploadingAttachments--;
    updateSendCommands(true);
  },

  QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIRequestObserver,
                                         Components.interfaces.nsISupportsWeakReference])
};

function deletionListener(aAttachment, aCloudProvider)
{
  this.attachment = aAttachment;
  this.cloudProvider = aCloudProvider;
}

deletionListener.prototype = {
  onStartRequest: function deletionListener_onStartRequest(aRequest, aContext) {
  },

  onStopRequest: function deletionListener_onStopRequest(aRequest, aContext,
                                                         aStatusCode) {
    if (!Components.isSuccessCode(aStatusCode)) {
      let displayName = cloudFileAccounts.getDisplayName(this.cloudProvider);
      Services.prompt.alert(window,
        getComposeBundle().getString("errorCloudFileDeletion.title"),
        getComposeBundle().getFormattedString("errorCloudFileDeletion.message",
                                              [displayName,
                                               this.attachment.name]));
    }
  },

  QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIRequestObserver,
                                         Components.interfaces.nsISupportsWeakReference])
};

/**
 * Prompt the user for a list of files to attach via a cloud provider.
 *
 * @param aProvider the cloud provider to upload the files to
 */
function attachToCloud(aProvider)
{
  // We need to let the user pick local file(s) to upload to the cloud and
  // gather url(s) to those files.
  var fp = Components.classes["@mozilla.org/filepicker;1"]
                     .createInstance(nsIFilePicker);
  fp.init(window, getComposeBundle().getFormattedString(
            "chooseFileToAttachViaCloud",
            [cloudFileAccounts.getDisplayName(aProvider)]),
          nsIFilePicker.modeOpenMultiple);

  var lastDirectory = GetLastAttachDirectory();
  if (lastDirectory)
    fp.displayDirectory = lastDirectory;

  let files = [];

  fp.appendFilters(nsIFilePicker.filterAll);
  if (fp.show() == nsIFilePicker.returnOK)
  {
    if (!fp.files)
      return;

    let files = [f for (f in fixIterator(fp.files,
                                         Components.interfaces.nsILocalFile))];
    let attachments = files.map(f => FileToAttachment(f));

    let i = 0;
    let items = AddAttachments(attachments, function(aItem) {
      let listener = new uploadListener(attachments[i], files[i], aProvider);
      try {
        aProvider.uploadFile(files[i], listener);
      }
      catch (ex) {
        listener.onStopRequest(null, null, ex.result);
      }
      i++;
    });

    dispatchAttachmentBucketEvent("attachments-uploading", attachments);
    SetLastAttachDirectory(files[files.length-1]);
  }
}

/**
 * Convert an array of attachments to cloud attachments.
 *
 * @param aItems an array of <attachmentitem>s containing the attachments in
 *        question
 * @param aProvider the cloud provider to upload the files to
 */
function convertListItemsToCloudAttachment(aItems, aProvider)
{
  // If we want to display an offline error message, we should do it here.
  // No sense in doing the delete and upload and having them fail.
  if (Services.io.offline)
    return;

  let fileHandler = Services.io.getProtocolHandler("file")
                            .QueryInterface(Components.interfaces.nsIFileProtocolHandler);
  let convertedAttachments = Components.classes["@mozilla.org/array;1"]
                                       .createInstance(Components.interfaces.nsIMutableArray);

  for (let item of aItems) {
    let url = item.attachment.url;

    if (item.attachment.sendViaCloud) {
      if (item.cloudProvider && item.cloudProvider == aProvider)
        continue;
      url = item.originalUrl;
    }

    let file = fileHandler.getFileFromURLSpec(url);
    if (item.cloudProvider) {
      item.cloudProvider.deleteFile(
        file, new deletionListener(item.attachment, item.cloudProvider));
    }

    try {
      let listener = new uploadListener(item.attachment, file,
                                        aProvider);
      aProvider.uploadFile(file, listener);
      convertedAttachments.appendElement(item.attachment, false);
    }
    catch (ex) {
      listener.onStopRequest(null, null, ex.result);
    }
  }

  if (convertedAttachments.length) {
    dispatchAttachmentBucketEvent("attachments-converted", convertedAttachments);
    Services.obs.notifyObservers(convertedAttachments,
                                 "mail:attachmentsConverted",
                                 aProvider.accountKey);
  }
}

/**
 * Convert the selected attachments to cloud attachments.
 *
 * @param aProvider the cloud provider to upload the files to
 */
function convertSelectedToCloudAttachment(aProvider)
{
  let bucket = document.getElementById("attachmentBucket");
  convertListItemsToCloudAttachment([...bucket.selectedItems], aProvider);
}

/**
 * Convert an array of nsIMsgAttachments to cloud attachments.
 *
 * @param aAttachments an array of nsIMsgAttachments
 * @param aProvider the cloud provider to upload the files to
 */
function convertToCloudAttachment(aAttachments, aProvider)
{
  let bucket = document.getElementById("attachmentBucket");
  let items = [];
  for (let attachment of aAttachments) {
    let item = bucket.findItemForAttachment(attachment);
    if (item)
      items.push(item);
  }

  convertListItemsToCloudAttachment(items, aProvider);
}

/**
 * Convert an array of attachments to regular (non-cloud) attachments.
 *
 * @param aItems an array of <attachmentitem>s containing the attachments in
 *        question
 */
function convertListItemsToRegularAttachment(aItems)
{
  let fileHandler = Services.io.getProtocolHandler("file")
                            .QueryInterface(Components.interfaces.nsIFileProtocolHandler);
  let convertedAttachments = Components.classes["@mozilla.org/array;1"]
                                       .createInstance(Components.interfaces.nsIMutableArray);

  for (let item of aItems) {
    if (!item.attachment.sendViaCloud || !item.cloudProvider)
      continue;

    let file = fileHandler.getFileFromURLSpec(item.originalUrl);
    try {
      // This will fail for drafts, but we can still send the message
      // with a normal attachment.
      item.cloudProvider.deleteFile(
        file, new deletionListener(item.attachment, item.cloudProvider));
    }
    catch (ex) {
       Components.utils.reportError(ex);
    }

    item.attachment.url = item.originalUrl;
    item.setAttribute("tooltiptext", item.attachment.url);
    item.attachment.sendViaCloud = false;

    delete item.cloudProvider;
    delete item.originalUrl;
    item.image = null;

    convertedAttachments.appendElement(item.attachment, false);
  }

  dispatchAttachmentBucketEvent("attachments-converted", convertedAttachments);
  Services.obs.notifyObservers(convertedAttachments,
                               "mail:attachmentsConverted", null);

  // We leave the content location in for the notifications because
  // it may be needed to identify the attachment. But clear it out now.
  for (let [,item] in Iterator(aItems))
    delete item.attachment.contentLocation;
}

/**
 * Convert the selected attachments to regular (non-cloud) attachments.
 */
function convertSelectedToRegularAttachment()
{
  let bucket = document.getElementById("attachmentBucket");
  convertListItemsToRegularAttachment([...bucket.selectedItems]);
}

/**
 * Convert an array of nsIMsgAttachments to regular (non-cloud) attachments.
 *
 * @param aAttachments an array of nsIMsgAttachments
 */
function convertToRegularAttachment(aAttachments)
{
  let bucket = document.getElementById("attachmentBucket");
  let items = [];
  for (let [,attachment] in Iterator(aAttachments)) {
    let item = bucket.findItemForAttachment(attachment);
    if (item)
      items.push(item);
  }

  convertListItemsToRegularAttachment(items);
}

function updateOptionItems()
{
  goUpdateCommand("cmd_quoteMessage");
}

/* messageComposeOfflineQuitObserver is notified whenever the network
 * connection status has switched to offline, or when the application
 * has received a request to quit.
 */
var messageComposeOfflineQuitObserver =
{
  observe: function(aSubject, aTopic, aData)
  {
    // sanity checks
    if (aTopic == "network:offline-status-changed")
    {
      MessageComposeOfflineStateChanged(Services.io.offline);
    }
    // check whether to veto the quit request (unless another observer already
    // did)
    else if (aTopic == "quit-application-requested"
        && (aSubject instanceof Components.interfaces.nsISupportsPRBool)
        && !aSubject.data)
      aSubject.data = !ComposeCanClose();
  }
}

function AddMessageComposeOfflineQuitObserver()
{
  Services.obs.addObserver(messageComposeOfflineQuitObserver,
                           "network:offline-status-changed", false);
  Services.obs.addObserver(messageComposeOfflineQuitObserver,
                           "quit-application-requested", false);

  // set the initial state of the send button
  MessageComposeOfflineStateChanged(Services.io.offline);
}

function RemoveMessageComposeOfflineQuitObserver()
{
  Services.obs.removeObserver(messageComposeOfflineQuitObserver,
                              "network:offline-status-changed");
  Services.obs.removeObserver(messageComposeOfflineQuitObserver,
                              "quit-application-requested");
}

function MessageComposeOfflineStateChanged(goingOffline)
{
  try {
    var sendButton = document.getElementById("button-send");
    var sendNowMenuItem = document.getElementById("menu-item-send-now");

    if (!gSavedSendNowKey) {
      gSavedSendNowKey = sendNowMenuItem.getAttribute('key');
    }

    // don't use goUpdateCommand here ... the defaultController might not be installed yet
    updateSendCommands(false);

    if (goingOffline)
    {
      sendButton.label = sendButton.getAttribute('later_label');
      sendButton.setAttribute('tooltiptext', sendButton.getAttribute('later_tooltiptext'));
      sendNowMenuItem.removeAttribute('key');
    }
    else
    {
      sendButton.label = sendButton.getAttribute('now_label');
      sendButton.setAttribute('tooltiptext', sendButton.getAttribute('now_tooltiptext'));
      if (gSavedSendNowKey) {
        sendNowMenuItem.setAttribute('key', gSavedSendNowKey);
      }
    }

  } catch(e) {}
}

function DoCommandClose()
{
  if (ComposeCanClose()) {

    // Notify the SendListener that Send has been aborted and Stopped
    if (gMsgCompose)
      gMsgCompose.onSendNotPerformed(null, Components.results.NS_ERROR_ABORT);

    // note: if we're not caching this window, this destroys it for us
    MsgComposeCloseWindow(true);
  }

  return false;
}

function DoCommandPrint()
{
  try {
    let editor = GetCurrentEditorElement();
    PrintUtils.printWindow(editor.outerWindowID, editor);
  } catch(ex) {dump("#PRINT ERROR: " + ex + "\n");}
}

function DoCommandPrintPreview()
{
  try {
    PrintUtils.printPreview(PrintPreviewListener);
    } catch(ex) { Components.utils.reportError(ex); }
}

/**
 * Locks/Unlocks the window widgets while a message is being saved/sent.
 * Locking means to disable all possible items in the window so that
 * the user can't click/activate anything.
 *
 * @param aDisable  true = lock the window. false = unlock the window.
 */
function ToggleWindowLock(aDisable)
{
  gWindowLocked = aDisable;
  updateAllItems(aDisable);
  updateEditableFields(aDisable);
  if (!aDisable)
    updateComposeItems();
}

/* This function will go away soon as now arguments are passed to the window using a object of type nsMsgComposeParams instead of a string */
function GetArgs(originalData)
{
  var args = new Object();

  if (originalData == "")
    return null;

  var data = "";
  var separator = String.fromCharCode(1);

  var quoteChar = "";
  var prevChar = "";
  var nextChar = "";
  for (let i = 0; i < originalData.length; i++, prevChar = aChar)
  {
    var aChar = originalData.charAt(i)
    var aCharCode = originalData.charCodeAt(i)
    if ( i < originalData.length - 1)
      nextChar = originalData.charAt(i + 1);
    else
      nextChar = "";

    if (aChar == quoteChar && (nextChar == "," || nextChar == ""))
    {
      quoteChar = "";
      data += aChar;
    }
    else if ((aCharCode == 39 || aCharCode == 34) && prevChar == "=") //quote or double quote
    {
      if (quoteChar == "")
        quoteChar = aChar;
      data += aChar;
    }
    else if (aChar == ",")
    {
      if (quoteChar == "")
        data += separator;
      else
        data += aChar
    }
    else
      data += aChar
  }

  var pairs = data.split(separator);
//  dump("Compose: argument: {" + data + "}\n");

  for (let i = pairs.length - 1; i >= 0; i--)
  {
    var pos = pairs[i].indexOf('=');
    if (pos == -1)
      continue;
    var argname = pairs[i].substring(0, pos);
    var argvalue = pairs[i].substring(pos + 1);
    if (argvalue.startsWith("'") && argvalue.endsWith("'"))
      args[argname] = argvalue.substring(1, argvalue.length - 1);
    else
      try {
        args[argname] = decodeURIComponent(argvalue);
      } catch (e) {args[argname] = argvalue;}
    // dump("[" + argname + "=" + args[argname] + "]\n");
  }
  return args;
}

function ComposeFieldsReady()
{
  // Limit the charsets to those we think are safe to encode (i.e., they are in
  // the charset menu). Easiest way to normalize this is to use the TextDecoder
  // to get the canonical alias and default if it isn't valid.
  let charset;
  try {
    charset = new TextDecoder(gMsgCompose.compFields.characterSet).encoding;
  } catch (e) {
    charset = gMsgCompose.compFields.defaultCharacterSet;
  }
  SetDocumentCharacterSet(charset);

  //If we are in plain text, we need to set the wrap column
  if (! gMsgCompose.composeHTML) {
    try {
      gMsgCompose.editor.QueryInterface(nsIPlaintextEditorMail).wrapWidth
          = gMsgCompose.wrapLength;
    }
    catch (e) {
      dump("### textEditor.wrapWidth exception text: " + e + " - failed\n");
    }
  }
  CompFields2Recipients(gMsgCompose.compFields);
  SetComposeWindowTitle();
  updateEditableFields(false);
}

// checks if the passed in string is a mailto url, if it is, generates nsIMsgComposeParams
// for the url and returns them.
function handleMailtoArgs(mailtoUrl)
{
  // see if the string is a mailto url....do this by checking the first 7 characters of the string
  if (mailtoUrl.toLowerCase().startsWith("mailto:"))
  {
    // if it is a mailto url, turn the mailto url into a MsgComposeParams object....
    let uri = Services.io.newURI(mailtoUrl, null, null);

    if (uri) {
      return MailServices.compose.getParamsForMailto(uri);
    }
  }

  return null;
}

/**
 * Handle ESC keypress from composition window for
 * notifications with close button in the
 * attachmentNotificationBox.
 */
function handleEsc()
{
  let activeElement = document.activeElement;

  // If findbar is visible and the focus is in the message body,
  // hide it. (Focus on the findbar is handled by findbar itself).
  let findbar = document.getElementById('FindToolbar');
  if (!findbar.hidden && activeElement.id == "content-frame") {
    findbar.close();
    return;
  }

  // If there is a notification in the attachmentNotificationBox
  // AND focus is in message body, subject field or on the notification,
  // hide it.
  let notification = document.getElementById("attachmentNotificationBox")
                             .currentNotification;
  if (notification && (activeElement.id == "content-frame" ||
      activeElement.parentNode.parentNode.id == "msgSubject" ||
      notification.contains(activeElement) ||
      activeElement.classList.contains("messageCloseButton"))) {
    notification.close();
  }
}

/**
 * This state machine manages all showing and hiding of the attachment
 * notification bar. It is only called if any change happened so that
 * recalculating of the notification is needed:
 * - keywords changed
 * - manual reminder was toggled
 * - attachments changed
 *
 * It does not track whether the notification is still up when it should be.
 * That allows the user to close it any time without this function showing
 * it again.
 * We ensure notification is only shown on right events, e.g. only when we have
 * keywords and attachments were removed (but not when we have keywords and
 * manual reminder was just turned off). We always show the notification
 * again if keywords change (if no attachments and no manual reminder).
 *
 * @param aForce  If set to true, notification will be shown immediately if
 *                there are any keywords. If set to false, it is shown only when
 *                they have changed.
 */
function manageAttachmentNotification(aForce = false)
{
  let keywords;
  let keywordsCount = 0;

  // First see if the notification is to be hidden due to reasons other than
  // not having keywords.
  let removeNotification = attachmentNotificationSupressed();

  // If that is not true, we need to look at the state of keywords.
  if (!removeNotification) {
    if (attachmentWorker.lastMessage) {
      // We know the state of keywords, so process them.
      if (attachmentWorker.lastMessage.length) {
        keywords = attachmentWorker.lastMessage.join(", ");
        keywordsCount = attachmentWorker.lastMessage.length;
      }
      removeNotification = keywordsCount == 0;
    } else {
      // We don't know keywords, so get them first.
      // If aForce was true, and some keywords are found, we get to run again from
      // attachmentWorker.onmessage().
      gAttachmentNotifier.redetectKeywords(aForce);
      return;
    }
  }

  let nBox = document.getElementById("attachmentNotificationBox");
  let notification = nBox.getNotificationWithValue("attachmentReminder");
  if (removeNotification) {
    if (notification)
      nBox.removeNotification(notification);

    return;
  }

  // We have some keywords, however only pop up the notification if requested
  // to do so.
  if (!aForce)
    return;

  let textValue = getComposeBundle().getString("attachmentReminderKeywordsMsgs");
  textValue = PluralForm.get(keywordsCount, textValue)
                        .replace("#1", keywordsCount);
  // If the notification already exists, we simply add the new attachment
  // specific keywords to the existing notification instead of creating it
  // from scratch.
  if (notification) {
    let description = notification.querySelector("#attachmentReminderText");
    description.setAttribute("value", textValue);
    description = notification.querySelector("#attachmentKeywords");
    description.setAttribute("value", keywords);
    return;
  }

  // Construct the notification as we don't have one.
  let msg = document.createElement("hbox");
  msg.setAttribute("flex", "100");
  msg.onclick = function(event) {
    openOptionsDialog("paneCompose", "generalTab",
                      {subdialog: "attachment_reminder_button"});
  };

  let msgText = document.createElement("label");
  msg.appendChild(msgText);
  msgText.id = "attachmentReminderText";
  msgText.setAttribute("crop", "end");
  msgText.setAttribute("flex", "1");
  msgText.setAttribute("value", textValue);
  let msgKeywords = document.createElement("label");
  msg.appendChild(msgKeywords);
  msgKeywords.id = "attachmentKeywords";
  msgKeywords.setAttribute("crop", "end");
  msgKeywords.setAttribute("flex", "1000");
  msgKeywords.setAttribute("value", keywords);
  let addButton = {
    accessKey : getComposeBundle().getString("addAttachmentButton.accesskey"),
    label: getComposeBundle().getString("addAttachmentButton"),
    callback: function (aNotificationBar, aButton) {
        goDoCommand("cmd_attachFile");
    }
  };

  let remindButton = {
    accessKey : getComposeBundle().getString("remindLaterButton.accesskey"),
    label: getComposeBundle().getString("remindLaterButton"),
    callback: function (aNotificationBar, aButton) {
      toggleAttachmentReminder(true);
    }
  };

  notification = nBox.appendNotification("", "attachmentReminder",
                               /* fake out the image so we can do it in CSS */
                               "null",
                               nBox.PRIORITY_WARNING_MEDIUM,
                               [addButton, remindButton]);
  let buttons = notification.childNodes[0];
  notification.insertBefore(msg, buttons);
}

/**
 * Returns whether the attachment notification should be supressed regardless of
 * the state of keywords.
 */
function attachmentNotificationSupressed() {
  return (gManualAttachmentReminder ||
          document.getElementById("attachmentBucket").itemCount);
}

var attachmentWorker = new Worker("resource:///modules/attachmentChecker.js");

// The array of currently found keywords. Or null if keyword detection wasn't
// run yet so we don't know.
attachmentWorker.lastMessage = null;

attachmentWorker.onerror = function(error)
{
  Components.utils.reportError("Attachment Notification Worker error!!! " + error.message);
  throw error;
};

/**
 * Called when attachmentWorker finishes checking of the message for keywords.
 *
 * @param event    If defined, event.data contains an array of found keywords.
 * @param aManage  If set to true and we determine keywords have changed,
 *                 manage the notification.
 *                 If set to false, just store the new keyword list but do not
 *                 touch the notification. That effectively eats the
 *                 "keywords changed" event which usually shows the notification
 *                 if it was hidden. See manageAttachmentNotification().
 */
attachmentWorker.onmessage = function(event, aManage = true)
{
  // Exit if keywords haven't changed.
  if (!event || (attachmentWorker.lastMessage &&
                (event.data.toString() == attachmentWorker.lastMessage.toString())))
    return;

  let data = event ? event.data : [];
  attachmentWorker.lastMessage = data.slice(0);
  if (aManage)
    manageAttachmentNotification(true);
};

/**
 * Called when number of attachments changes.
 */
function AttachmentsChanged() {
  manageAttachmentNotification(true);
}

/**
 * This functions retrieves the spellchecker dictionary from the corresponding
 * preference and ensures that such a dictionary in fact exists. If not, it
 * adjusts the preference accordingly.
 * When the nominated dictionary does not exist, the effects are very confusing
 * to the user: Inline spell checking does not work, although the option is
 * selected and a spell check dictionary seems to be selected in the options
 * dialog (the dropdown shows the first list member if the value is not in
 * the list). It is not at all obvious that the preference value is wrong.
 * This case can happen two scenarios:
 * 1) The dictionary that was selected in the preference is removed.
 * 2) The selected dictionay changes the way it announces itself to the system,
 *    so for example "it_IT" changes to "it-IT" and the previously stored
 *    preference value doesn't apply any more.
 */
function getValidSpellcheckerDictionary() {
  let prefValue = Services.prefs.getCharPref("spellchecker.dictionary");
  let spellChecker = Components.classes["@mozilla.org/spellchecker/engine;1"]
                               .getService(mozISpellCheckingEngine);
  let o1 = {};
  let o2 = {};
  spellChecker.getDictionaryList(o1, o2);
  let dictList = o1.value;
  let count    = o2.value;

  if (count == 0) {
    // If there are no dictionaries, we can't check the value, so return it.
    return prefValue;
  }

  // Make sure preference contains a valid value.
  if (dictList.includes(prefValue)) {
    return prefValue;
  }

  // Set a valid value, any value will do.
  Services.prefs.setCharPref("spellchecker.dictionary", dictList[0]);
  return dictList[0];
}

var dictionaryRemovalObserver =
{
  observe: function(aSubject, aTopic, aData) {
    if (aTopic != "spellcheck-dictionary-remove") {
      return;
    }
    let language = document.documentElement.getAttribute("lang");
    let spellChecker = Components.classes["@mozilla.org/spellchecker/engine;1"]
                                 .getService(mozISpellCheckingEngine);
    let o1 = {};
    let o2 = {};
    spellChecker.getDictionaryList(o1, o2);
    let dictList = o1.value;
    let count    = o2.value;

    if (count > 0 && dictList.includes(language)) {
      // There still is a dictionary for the language of the document.
      return;
    }

    // Set a valid language from the preference.
    let prefValue = Services.prefs.getCharPref("spellchecker.dictionary");
    if (count == 0 || dictList.includes(prefValue)) {
      language = prefValue;
    } else {
      language = dictList[0];
      // Fix the preference while we're here. We know it's invalid.
      Services.prefs.setCharPref("spellchecker.dictionary", language);
    }
    document.documentElement.setAttribute("lang", language);
  },

  isAdded: false,

  addObserver: function() {
    Services.obs.addObserver(this, "spellcheck-dictionary-remove", false);
    this.isAdded = true;
  },

  removeObserver: function() {
    // We need to protect against double removal:
    // The window can be recycled and later destroyed (at shutdown or when the
    // composition style changes from HTML to plain text or vice versa) or
    // only destroyed if it was never recycled before.
    if (this.isAdded) {
      Services.obs.removeObserver(this, "spellcheck-dictionary-remove");
      this.isAdded = false;
    }
  }
}

function ComposeStartup(recycled, aParams)
{
  // Findbar overlay
  if (!document.getElementById("findbar-replaceButton")) {
    let replaceButton = document.createElement("toolbarbutton");
    replaceButton.setAttribute("id", "findbar-replaceButton");
    replaceButton.setAttribute("class", "findbar-button tabbable");
    replaceButton.setAttribute("label", getComposeBundle().getString("replaceButton.label"));
    replaceButton.setAttribute("accesskey", getComposeBundle().getString("replaceButton.accesskey"));
    replaceButton.setAttribute("tooltiptext", getComposeBundle().getString("replaceButton.tooltip"));
    replaceButton.setAttribute("oncommand", "findbarFindReplace();");

    let findbar = document.getElementById("FindToolbar");
    let lastButton = findbar.getElement("find-case-sensitive");
    let tSeparator = document.createElement("toolbarseparator");
    tSeparator.setAttribute("id", "findbar-beforeReplaceSeparator");
    lastButton.parentNode.insertBefore(replaceButton, lastButton.nextSibling);
    lastButton.parentNode.insertBefore(tSeparator, lastButton.nextSibling);
  }

  var params = null; // New way to pass parameters to the compose window as a nsIMsgComposeParameters object
  var args = null;   // old way, parameters are passed as a string

  if (aParams)
    params = aParams;
  else if (window.arguments && window.arguments[0]) {
    try {
      if (window.arguments[0] instanceof Components.interfaces.nsIMsgComposeParams)
        params = window.arguments[0];
      else
        params = handleMailtoArgs(window.arguments[0]);
    }
    catch(ex) { dump("ERROR with parameters: " + ex + "\n"); }

    // if still no dice, try and see if the params is an old fashioned list of string attributes
    // XXX can we get rid of this yet?
    if (!params)
    {
      args = GetArgs(window.arguments[0]);
    }
  }

  // Set a sane starting width/height for all resolutions on new profiles.
  // Do this before the window loads.
  if (!document.documentElement.hasAttribute("width"))
  {
    // Prefer 860x800.
    let defaultHeight = Math.min(screen.availHeight, 800);
    let defaultWidth = Math.min(screen.availWidth, 860);

    // On small screens, default to maximized state.
    if (defaultHeight <= 600)
      document.documentElement.setAttribute("sizemode", "maximized");

    document.documentElement.setAttribute("width", defaultWidth);
    document.documentElement.setAttribute("height", defaultHeight);
    // Make sure we're safe at the left/top edge of screen
    document.documentElement.setAttribute("screenX", screen.availLeft);
    document.documentElement.setAttribute("screenY", screen.availTop);
  }

  // Observe the language attribute so we can update the language button label.
  gLanguageObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.type == "attributes" && mutation.attributeName == "lang") {
        updateLanguageInStatusBar();
      }
    });
  });
  gLanguageObserver.observe(document.documentElement, { attributes: true });

  // Observe dictionary removals.
  dictionaryRemovalObserver.addObserver();

  // Set document language to the preference as early as possible.
  let languageToSet = getValidSpellcheckerDictionary();
  document.documentElement.setAttribute("lang", languageToSet);

  var identityList = document.getElementById("msgIdentity");

  document.addEventListener("keypress", awDocumentKeyPress, true);

  if (identityList)
    FillIdentityList(identityList);

  if (!params) {
    // This code will go away soon as now arguments are passed to the window using a object of type nsMsgComposeParams instead of a string

    params = Components.classes["@mozilla.org/messengercompose/composeparams;1"].createInstance(Components.interfaces.nsIMsgComposeParams);
    params.composeFields = Components.classes["@mozilla.org/messengercompose/composefields;1"].createInstance(Components.interfaces.nsIMsgCompFields);

    if (args) { //Convert old fashion arguments into params
      var composeFields = params.composeFields;
      if (args.bodyislink == "true")
        params.bodyIsLink = true;
      if (args.type)
        params.type = args.type;
      if (args.format)
        params.format = args.format;
      if (args.originalMsg)
        params.originalMsgURI = args.originalMsg;
      if (args.preselectid)
        params.identity = getIdentityForKey(args.preselectid);
      if (args.to)
        composeFields.to = args.to;
      if (args.cc)
        composeFields.cc = args.cc;
      if (args.bcc)
        composeFields.bcc = args.bcc;
      if (args.newsgroups)
        composeFields.newsgroups = args.newsgroups;
      if (args.subject)
        composeFields.subject = args.subject;
      if (args.attachment)
      {
        let attachmentList = args.attachment.split(",");
        let commandLine = Components.classes["@mozilla.org/toolkit/command-line;1"]
                                    .createInstance();
        for (let [,attachmentName] in Iterator(attachmentList))
        {
          // resolveURI does all the magic around working out what the
          // attachment is, including web pages, and generating the correct uri.
          let uri = commandLine.resolveURI(attachmentName);
          let attachment = Components.classes["@mozilla.org/messengercompose/attachment;1"]
                                     .createInstance(Components.interfaces.nsIMsgAttachment);
          // If uri is for a file and it exists set the attachment size.
          if (uri instanceof Components.interfaces.nsIFileURL)
          {
            if (uri.file.exists())
              attachment.size = uri.file.fileSize;
            else
              attachment = null;
          }

          // Only want to attach if a file that exists or it is not a file.
          if (attachment)
          {
            attachment.url = uri.spec;
            composeFields.addAttachment(attachment);
          }
          else
          {
            let title = getComposeBundle().getString("errorFileAttachTitle");
            let msg = getComposeBundle().getFormattedString("errorFileAttachMessage",
                                                        [attachmentName]);
            Services.prompt.alert(window, title, msg);
          }
        }
      }
      if (args.newshost)
        composeFields.newshost = args.newshost;
      if (args.body)
         composeFields.body = args.body;
    }
  }

  gComposeType = params.type;

  // " <>" is an empty identity, and most likely not valid
  if (!params.identity || params.identity.identityName == " <>") {
    // no pre selected identity, so use the default account
    let identities = MailServices.accounts.defaultAccount.identities;
    if (identities.length == 0)
      identities = MailServices.accounts.allIdentities;
    params.identity = identities.queryElementAt(0, Components.interfaces.nsIMsgIdentity);
  }

  identityList.selectedItem =
    identityList.getElementsByAttribute("identitykey", params.identity.key)[0];
  if (params.composeFields.from)
  {
    let from = MailServices.headerParser.parseEncodedHeader(params.composeFields.from, null).join(", ");
    if (from != identityList.value)
    {
      MakeFromFieldEditable(true);
      identityList.value = from;
    }
  }
  LoadIdentity(true);

  // Get the <editor> element to startup an editor
  var editorElement = GetCurrentEditorElement();
  gMsgCompose = MailServices.compose.initCompose(params, window, editorElement.docShell);

  // Set the close listener.
  gMsgCompose.recyclingListener = gComposeRecyclingListener;
  gMsgCompose.addMsgSendListener(gSendListener);
  // Lets the compose object know that we are dealing with a recycled window.
  gMsgCompose.recycledWindow = recycled;

  document.getElementById("returnReceiptMenu")
          .setAttribute('checked', gMsgCompose.compFields.returnReceipt);
  document.getElementById("dsnMenu")
          .setAttribute("checked", gMsgCompose.compFields.DSN);
  document.getElementById("cmd_attachVCard")
          .setAttribute("checked", gMsgCompose.compFields.attachVCard);
  toggleAttachmentReminder(gMsgCompose.compFields.attachmentReminder);

  // If recycle, editor is already created.
  if (!recycled)
  {
    let editortype = gMsgCompose.composeHTML ? "htmlmail" : "textmail";
    editorElement.makeEditable(editortype, true);

    // setEditorType MUST be called before setContentWindow
    if (gMsgCompose.composeHTML)
    {
      initLocalFontFaceMenu(document.getElementById("FontFacePopup"));
    }
    else
    {
      // Remove HTML toolbar, format and insert menus as we are editing in
      // plain text mode.
      document.getElementById("outputFormatMenu").setAttribute("hidden", true);
      document.getElementById("FormatToolbar").setAttribute("hidden", true);
      document.getElementById("formatMenu").setAttribute("hidden", true);
      document.getElementById("insertMenu").setAttribute("hidden", true);
      document.getElementById("menu_showFormatToolbar").setAttribute("hidden", true);
    }

    // Do setup common to Message Composer and Web Composer.
    EditorSharedStartup();
  }

  if (params.bodyIsLink)
  {
    let body = gMsgCompose.compFields.body;
    if (gMsgCompose.composeHTML)
    {
      let cleanBody;
      try {
        cleanBody = decodeURI(body);
      } catch(e) { cleanBody = body; }

      body = body.replace(/&/g, "&amp;");
      gMsgCompose.compFields.body =
        "<br /><a href=\"" + body + "\">" + cleanBody + "</a><br />";
    }
    else
    {
      gMsgCompose.compFields.body = "\n<" + body + ">\n";
    }
  }

  GetMsgSubjectElement().value = gMsgCompose.compFields.subject;

  AddAttachments(gMsgCompose.compFields.attachments);

  document.getElementById("msgcomposeWindow").dispatchEvent(
    new Event("compose-window-init", { bubbles: false , cancelable: true }));

  gMsgCompose.RegisterStateListener(stateListener);

  if (recycled)
  {
    InitEditor();

    if (gMsgCompose.composeHTML)
    {
      // Force color picker on toolbar to show document colors.
      onFontColorChange();
      onBackgroundColorChange();
    }

    // Reset the priority field for recycled windows.
    updatePriorityToolbarButton("Normal");
  }
  else
  {
    // Add an observer to be called when document is done loading,
    // which creates the editor.
    try {
      GetCurrentCommandManager().
              addCommandObserver(gMsgEditorCreationObserver, "obs_documentCreated");

      // Load empty page to create the editor.
      editorElement.webNavigation.loadURI("about:blank", 0, null, null, null);
    } catch (e) {
      Components.utils.reportError(e);
    }
  }

  gEditingDraft = gMsgCompose.compFields.draftId;

  // finally, see if we need to auto open the address sidebar.
  var sideBarBox = document.getElementById('sidebar-box');
  if (sideBarBox.getAttribute("sidebarVisible") == "true")
  {
    // if we aren't supposed to have the side bar hidden, make sure it is visible
    if (document.getElementById("sidebar").getAttribute("src") == "")
      setTimeout(toggleAddressPicker, 0);   // do this on a delay so we don't hurt perf. on bringing up a new compose window
  }
  gAutoSaveInterval = getPref("mail.compose.autosave") ?
    getPref("mail.compose.autosaveinterval") * 60000 : 0;

  if (gAutoSaveInterval)
    gAutoSaveTimeout = setTimeout(AutoSave, gAutoSaveInterval);

  gAutoSaveKickedIn = false;
}

// The new, nice, simple way of getting notified when a new editor has been created
var gMsgEditorCreationObserver =
{
  observe: function(aSubject, aTopic, aData)
  {
    if (aTopic == "obs_documentCreated")
    {
      var editor = GetCurrentEditor();
      if (editor && GetCurrentCommandManager() == aSubject)
      {
        var editorStyle = editor.QueryInterface(Components.interfaces.nsIEditorStyleSheets);
        // We use addOverrideStyleSheet rather than addStyleSheet so that we get
        // a synchronous load, rather than having a late-finishing async load
        // mark our editor as modified when the user hasn't typed anything yet,
        // but that means the sheet must not @import slow things, especially
        // not over the network.
        editorStyle.addOverrideStyleSheet("chrome://messenger/skin/messageQuotes.css");
        InitEditor();
      }
      // Now that we know this document is an editor, update commands now if
      // the document has focus, or next time it receives focus via
      // CommandUpdate_MsgCompose()
      if (gLastWindowToHaveFocus == document.commandDispatcher.focusedWindow)
        updateComposeItems();
      else
        gLastWindowToHaveFocus = null;
    }
  }
}

function WizCallback(state)
{
  if (state){
    ComposeStartup(false, null);
  }
  else
  {
    // The account wizard is still closing so we can't close just yet
    setTimeout(MsgComposeCloseWindow, 0, false); // Don't recycle a bogus window
  }
}

function ComposeLoad()
{
  try {
    var other_headers = getPref("mail.compose.other.header");
  }
  catch (ex) {
    dump("failed to get the mail.compose.other.header pref\n");
  }

  AddMessageComposeOfflineQuitObserver();

  try {
    // XXX: We used to set commentColumn on the initial auto complete column after the document has loaded
    // inside of setupAutocomplete. But this happens too late for the first widget and it was never showing
    // the comment field. Try to set it before the document finishes loading:
    if (getPref("mail.autoComplete.commentColumn"))
      document.getElementById('addressCol2#1').showCommentColumn = true;
  }
  catch (ex) {
    // do nothing...
  }

  try {
    SetupCommandUpdateHandlers();
    // This will do migration, or create a new account if we need to.
    // We also want to open the account wizard if no identities are found
    var state = verifyAccounts(WizCallback, true);

    if (other_headers) {
      var selectNode = document.getElementById('addressCol1#1');
      var other_headers_Array = other_headers.split(",");
      for (let i = 0; i < other_headers_Array.length; i++)
        selectNode.appendItem(other_headers_Array[i] + ":", "addr_other");
    }
    if (state)
      ComposeStartup(false, null);
  }
  catch (ex) {
    Components.utils.reportError(ex);
    Services.prompt.alert(window, getComposeBundle().getString("initErrorDlogTitle"),
                          getComposeBundle().getString("initErrorDlgMessage"));

    MsgComposeCloseWindow(false); // Don't try to recycle a bogus window
    return;
  }

  ToolbarIconColor.init();

  // initialize the customizeDone method on the customizeable toolbar
  var toolbox = document.getElementById("compose-toolbox");
  toolbox.customizeDone = function(aEvent) { MailToolboxCustomizeDone(aEvent, "CustomizeComposeToolbar"); };

  var toolbarset = document.getElementById('customToolbars');
  toolbox.toolbarset = toolbarset;

  awInitializeNumberOfRowsShown();
}

function ComposeUnload()
{
  UnloadCommandUpdateHandlers();

  // Stop gSpellChecker so personal dictionary is saved
  enableInlineSpellCheck(false);

  EditorCleanup();

  if (gMsgCompose)
    gMsgCompose.removeMsgSendListener(gSendListener);

  RemoveMessageComposeOfflineQuitObserver();
  gAttachmentNotifier.shutdown();
  ToolbarIconColor.uninit();

  // Stop observing dictionary removals.
  dictionaryRemovalObserver.removeObserver();

  if (gMsgCompose)
    gMsgCompose.UnregisterStateListener(stateListener);
  if (gAutoSaveTimeout)
    clearTimeout(gAutoSaveTimeout);
  if (msgWindow)
    msgWindow.closeWindow();

  ReleaseGlobalVariables();
}

function SetDocumentCharacterSet(aCharset)
{
  if (gMsgCompose) {
    gMsgCompose.SetDocumentCharset(aCharset);
    SetComposeWindowTitle();
  }
  else
    dump("Compose has not been created!\n");
}

function GetCharsetUIString()
{
  // The charset here is already the canonical charset (not an alias).
  let charset = gMsgCompose.compFields.characterSet;
  if (!charset)
    return "";

  if (charset.toLowerCase() != gMsgCompose.compFields.defaultCharacterSet.toLowerCase()) {
    try {
      return " - " + gCharsetConvertManager.getCharsetTitle(charset);
    }
    catch(e) { // Not a canonical charset after all...
      Components.utils.reportError("Not charset title for charset=" + charset);
      return " - " + charset;
    }
  }
  return "";
}

// Add-ons can override this to customize the behavior.
function DoSpellCheckBeforeSend()
{
  return getPref("mail.SpellCheckBeforeSend");
}

/**
 * Handles message sending operations.
 * @param msgType nsIMsgCompDeliverMode of the operation.
 */
function GenericSendMessage(msgType)
{
  var msgCompFields = gMsgCompose.compFields;

  Recipients2CompFields(msgCompFields);
  let addresses = MailServices.headerParser
                              .makeFromDisplayAddress(GetMsgIdentityElement().value);
  msgCompFields.from = MailServices.headerParser.makeMimeHeader(addresses, addresses.length);
  var subject = GetMsgSubjectElement().value;
  msgCompFields.subject = subject;
  Attachments2CompFields(msgCompFields);
  // Some other msgCompFields have already been updated instantly in their respective
  // toggle functions, e.g. ToggleReturnReceipt(), ToggleDSN(),  ToggleAttachVCard(),
  // and toggleAttachmentReminder().

  let sending = msgType == nsIMsgCompDeliverMode.Now ||
      msgType == nsIMsgCompDeliverMode.Later ||
      msgType == nsIMsgCompDeliverMode.Background;
  if (sending)
  {
    expandRecipients();
    // Check if e-mail addresses are complete, in case user turned off
    // autocomplete to local domain.
    if (!CheckValidEmailAddress(msgCompFields))
      return;

    // Do we need to check the spelling?
    if (DoSpellCheckBeforeSend())
    {
      // We disable spellcheck for the following -subject line, attachment
      // pane, identity and addressing widget therefore we need to explicitly
      // focus on the mail body when we have to do a spellcheck.
      SetMsgBodyFrameFocus();
      window.cancelSendMessage = false;
      window.openDialog("chrome://editor/content/EdSpellCheck.xul", "_blank",
                        "dialog,close,titlebar,modal,resizable", true, true, false);

      if (window.cancelSendMessage)
        return;
    }

    // Strip trailing spaces and long consecutive WSP sequences from the
    // subject line to prevent getting only WSP chars on a folded line.
    let fixedSubject = subject.replace(/\s{74,}/g, "    ").trimRight();
    if (fixedSubject != subject)
    {
      subject = fixedSubject;
      msgCompFields.subject = fixedSubject;
      GetMsgSubjectElement().value = fixedSubject;
    }

    // Remind the person if there isn't a subject
    if (subject == "")
    {
      if (Services.prompt.confirmEx(
            window,
            getComposeBundle().getString("subjectEmptyTitle"),
            getComposeBundle().getString("subjectEmptyMessage"),
            (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) +
            (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_1),
            getComposeBundle().getString("sendWithEmptySubjectButton"),
            getComposeBundle().getString("cancelSendingButton"),
            null, null, {value:0}) == 1)
      {
        GetMsgSubjectElement().focus();
        return;
      }
    }

    // Attachment Reminder: Alert the user if
    //  - the user requested "Remind me later" from either the notification bar or the menu
    //    (alert regardless of the number of files already attached: we can't guess for how many
    //    or which files users want the reminder, and guessing wrong will annoy them a lot), OR
    //  - the aggressive pref is set and the latest notification is still showing (implying
    //    that the message has no attachment(s) yet, message still contains some attachment
    //    keywords, and notification was not dismissed).
    if (gManualAttachmentReminder || (getPref("mail.compose.attachment_reminder_aggressive") &&
         document.getElementById("attachmentNotificationBox")
                 .getNotificationWithValue("attachmentReminder"))) {
      let flags = Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING +
                  Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_IS_STRING;
      let hadForgotten = Services.prompt.confirmEx(window,
                            getComposeBundle().getString("attachmentReminderTitle"),
                            getComposeBundle().getString("attachmentReminderMsg"),
                            flags,
                            getComposeBundle().getString("attachmentReminderFalseAlarm"),
                            getComposeBundle().getString("attachmentReminderYesIForgot"),
                            null, null, {value:0});
      // Deactivate manual attachment reminder after showing the alert to avoid alert loop.
      // We also deactivate reminder when user ignores alert with [x] or [ESC].
      if (gManualAttachmentReminder)
        toggleAttachmentReminder(false);

      if (hadForgotten)
        return;
    }

    // Check if the user tries to send a message to a newsgroup through a mail
    // account.
    var currentAccountKey = getCurrentAccountKey();
    let account = MailServices.accounts.getAccount(currentAccountKey);
    if (!account)
    {
      throw new Error("currentAccountKey '" + currentAccountKey +
                      "' has no matching account!");
    }
    if (account.incomingServer.type != "nntp" && msgCompFields.newsgroups != "")
    {
      const kDontAskAgainPref = "mail.compose.dontWarnMail2Newsgroup";
      // default to ask user if the pref is not set
      let dontAskAgain = getPref(kDontAskAgainPref);
      if (!dontAskAgain)
      {
        let checkbox = {value:false};
        let okToProceed = Services.prompt.confirmCheck(
                              window,
                              getComposeBundle().getString("noNewsgroupSupportTitle"),
                              getComposeBundle().getString("recipientDlogMessage"),
                              getComposeBundle().getString("CheckMsg"),
                              checkbox);
        if (!okToProceed)
          return;

        if (checkbox.value) {
          Services.prefs.setBoolPref(kDontAskAgainPref, true);
        }
      }

      // remove newsgroups to prevent news_p to be set
      // in nsMsgComposeAndSend::DeliverMessage()
      msgCompFields.newsgroups = "";
    }

    // Before sending the message, check what to do with HTML message,
    // eventually abort.
    var convert = DetermineConvertibility();
    var action = DetermineHTMLAction(convert);

    if (action == nsIMsgCompSendFormat.AskUser)
    {
      var recommAction = (convert == nsIMsgCompConvertible.No)
                          ? nsIMsgCompSendFormat.AskUser
                          : nsIMsgCompSendFormat.PlainText;
      var result2 = {action:recommAction, convertible:convert, abort:false};
      window.openDialog("chrome://messenger/content/messengercompose/askSendFormat.xul",
                        "askSendFormatDialog", "chrome,modal,titlebar,centerscreen",
                        result2);
      if (result2.abort)
        return;
      action = result2.action;
    }

    // We will remember the users "send format" decision in the address
    // collector code (see nsAbAddressCollector::CollectAddress())
    // by using msgCompFields.forcePlainText and msgCompFields.useMultipartAlternative
    // to determine the nsIAbPreferMailFormat (unknown, plaintext, or html).
    // If the user sends both, we remember html.
    switch (action)
    {
      case nsIMsgCompSendFormat.PlainText:
        msgCompFields.forcePlainText = true;
        msgCompFields.useMultipartAlternative = false;
        break;
      case nsIMsgCompSendFormat.HTML:
        msgCompFields.forcePlainText = false;
        msgCompFields.useMultipartAlternative = false;
        break;
      case nsIMsgCompSendFormat.Both:
        msgCompFields.forcePlainText = false;
        msgCompFields.useMultipartAlternative = true;
        break;
      default:
        throw new Error("Invalid nsIMsgCompSendFormat action; action=" + action);
    }
  }

  // hook for extra compose pre-processing
  Services.obs.notifyObservers(window, "mail:composeOnSend", null);

  var originalCharset = gMsgCompose.compFields.characterSet;
  // Check if the headers of composing mail can be converted to a mail charset.
  if (msgType == nsIMsgCompDeliverMode.Now ||
    msgType == nsIMsgCompDeliverMode.Later ||
    msgType == nsIMsgCompDeliverMode.Background ||
    msgType == nsIMsgCompDeliverMode.Save ||
    msgType == nsIMsgCompDeliverMode.SaveAsDraft ||
    msgType == nsIMsgCompDeliverMode.AutoSaveAsDraft ||
    msgType == nsIMsgCompDeliverMode.SaveAsTemplate)
  {
    var fallbackCharset = new Object;
    // Check encoding, switch to UTF-8 if the default encoding doesn't fit
    // and disable_fallback_to_utf8 isn't set for this encoding.
    if (!gMsgCompose.checkCharsetConversion(getCurrentIdentity(), fallbackCharset))
    {
      var disableFallback = false;
      try
      {
        disableFallback = getPref("mailnews.disable_fallback_to_utf8." + originalCharset);
      }
      catch (e) {}
      if (disableFallback)
        msgCompFields.needToCheckCharset = false;
      else
        fallbackCharset.value = "UTF-8";
    }

    if (fallbackCharset &&
        fallbackCharset.value && fallbackCharset.value != "")
      gMsgCompose.SetDocumentCharset(fallbackCharset.value);
  }

  try {
    // Just before we try to send the message, fire off the
    // compose-send-message event for listeners such as smime so they can do
    // any pre-security work such as fetching certificates before sending.
    var event = document.createEvent("UIEvents");
    event.initEvent("compose-send-message", false, true);
    var msgcomposeWindow = document.getElementById("msgcomposeWindow");
    msgcomposeWindow.setAttribute("msgtype", msgType);
    msgcomposeWindow.dispatchEvent(event);
    if (event.defaultPrevented)
      throw Components.results.NS_ERROR_ABORT;

    gAutoSaving = (msgType == nsIMsgCompDeliverMode.AutoSaveAsDraft);

    // disable the ui if we're not auto-saving
    if (!gAutoSaving)
      ToggleWindowLock(true);

    // If we're auto saving, mark the body as not changed here, and not
    // when the save is done, because the user might change it between now
    // and when the save is done.
    else
    {
      SetContentAndBodyAsUnmodified();
    }

    var progress = Components.classes["@mozilla.org/messenger/progress;1"]
                             .createInstance(Components.interfaces.nsIMsgProgress);
    if (progress)
    {
      progress.registerListener(progressListener);
      if (msgType == nsIMsgCompDeliverMode.Save ||
          msgType == nsIMsgCompDeliverMode.SaveAsDraft ||
          msgType == nsIMsgCompDeliverMode.AutoSaveAsDraft ||
          msgType == nsIMsgCompDeliverMode.SaveAsTemplate)
        gSaveOperationInProgress = true;
      else
        gSendOperationInProgress = true;
    }
    msgWindow.domWindow = window;
    msgWindow.rootDocShell.allowAuth = true;
    gMsgCompose.SendMsg(msgType, getCurrentIdentity(),
                        getCurrentAccountKey(), msgWindow, progress);
  }
  catch (ex) {
    Components.utils.reportError("GenericSendMessage FAILED: " + ex);
    ToggleWindowLock(false);
  }
  if (gMsgCompose && originalCharset != gMsgCompose.compFields.characterSet)
    SetDocumentCharacterSet(gMsgCompose.compFields.characterSet);
}

/**
 * Keep the Send buttons disabled until any recipient is entered.
 */
function updateSendLock()
{
  gSendLocked = true;
  if (!gMsgCompose)
    return;

  let msgCompFields = gMsgCompose.compFields;
  Recipients2CompFields(msgCompFields);
  // Enabled send buttons if anything was entered into the recipient fields.
  // A more thorough check will be performed when a send button is actually clicked.
  gSendLocked = !msgCompFields.hasRecipients;
}

/**
 * Check if the entered addresses are valid and alert the user if they are not.
 *
 * @param aMsgCompFields  A nsIMsgCompFields object containing the fields to check.
 */
function CheckValidEmailAddress(aMsgCompFields)
{
  if (!aMsgCompFields.hasRecipients) {
    Services.prompt.alert(window, getComposeBundle().getString("addressInvalidTitle"),
                          getComposeBundle().getString("noRecipients"));

    return false;
  }

  let invalidStr;
   // Crude check that the to, cc, and bcc fields contain at least one '@'.
   // We could parse each address, but that might be overkill.
  function isInvalidAddress(aAddress) {
    return (aAddress.length > 0 &&
            ((!aAddress.includes("@", 1) && aAddress.toLowerCase() != "postmaster") ||
              aAddress.endsWith("@")));
  }
  if (isInvalidAddress(aMsgCompFields.to))
    invalidStr = aMsgCompFields.to;
  else if (isInvalidAddress(aMsgCompFields.cc))
    invalidStr = aMsgCompFields.cc;
  else if (isInvalidAddress(aMsgCompFields.bcc))
    invalidStr = aMsgCompFields.bcc;
  if (invalidStr)
  {
    Services.prompt.alert(window, getComposeBundle().getString("addressInvalidTitle"),
                          getComposeBundle().getFormattedString("addressInvalid",
                          [invalidStr], 1));
    return false;
  }

  return true;
}

function SendMessage()
{
  let sendInBackground =
    Services.prefs.getBoolPref("mailnews.sendInBackground");
  if (sendInBackground && !Application.platformIsMac) {
    let enumerator = Services.wm.getEnumerator(null);
    let count = 0;
    while (enumerator.hasMoreElements() && count < 2) {
      let win = enumerator.getNext();
      count++;
    }
    if (count == 1)
      sendInBackground = false;
  }

  GenericSendMessage(sendInBackground ?
                     nsIMsgCompDeliverMode.Background :
                     nsIMsgCompDeliverMode.Now);
  ExitFullscreenMode();
}

function SendMessageWithCheck()
{
    var warn = getPref("mail.warn_on_send_accel_key");

    if (warn) {
        let checkValue = {value:false};
        let buttonPressed = Services.prompt.confirmEx(window,
              getComposeBundle().getString('sendMessageCheckWindowTitle'),
              getComposeBundle().getString('sendMessageCheckLabel'),
              (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) +
              (Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1),
              getComposeBundle().getString('sendMessageCheckSendButtonLabel'),
              null, null,
              getComposeBundle().getString('CheckMsg'),
              checkValue);
        if (buttonPressed != 0) {
            return;
        }
        if (checkValue.value) {
            Services.prefs.setBoolPref("mail.warn_on_send_accel_key", false);
        }
    }

  let sendInBackground = Services.prefs.getBoolPref("mailnews.sendInBackground");

  GenericSendMessage(Services.io.offline ? nsIMsgCompDeliverMode.Later :
                     (sendInBackground ?
                      nsIMsgCompDeliverMode.Background :
                      nsIMsgCompDeliverMode.Now));

  ExitFullscreenMode();
}

function SendMessageLater()
{
  GenericSendMessage(nsIMsgCompDeliverMode.Later);
  ExitFullscreenMode();
}

function ExitFullscreenMode()
{
  // On OS X we need to deliberately exit full screen mode after sending.
  if (Application.platformIsMac) {
    window.fullScreen = false;
  }
}

function Save()
{
  switch (defaultSaveOperation)
  {
    case "file"     : SaveAsFile(false);      break;
    case "template" : SaveAsTemplate(false);  break;
    default         : SaveAsDraft(false);     break;
  }
}

function SaveAsFile(saveAs)
{
  var subject = GetMsgSubjectElement().value;
  GetCurrentEditor().setDocumentTitle(subject);

  if (gMsgCompose.bodyConvertible() == nsIMsgCompConvertible.Plain)
    SaveDocument(saveAs, false, "text/plain");
  else
    SaveDocument(saveAs, false, "text/html");
  defaultSaveOperation = "file";
}

function SaveAsDraft()
{
  gAutoSaveKickedIn = false;
  gEditingDraft = true;

  GenericSendMessage(nsIMsgCompDeliverMode.SaveAsDraft);
  defaultSaveOperation = "draft";
}

function SaveAsTemplate()
{
  gAutoSaveKickedIn = false;
  gEditingDraft = false;

  GenericSendMessage(nsIMsgCompDeliverMode.SaveAsTemplate);
  defaultSaveOperation = "template";
}

// Sets the additional FCC, in addition to the default FCC.
function MessageFcc(aFolder)
{
  if (!gMsgCompose)
    return;

  var msgCompFields = gMsgCompose.compFields;
  if (!msgCompFields)
    return;

  // Get the uri for the folder to FCC into.
  var fccURI = aFolder.URI;
  msgCompFields.fcc2 = (msgCompFields.fcc2 == fccURI) ? "nocopy://" : fccURI;
}

function updatePriorityMenu()
{
  if (gMsgCompose)
  {
    var msgCompFields = gMsgCompose.compFields;
    if (msgCompFields && msgCompFields.priority)
    {
      var priorityMenu = document.getElementById('priorityMenu' );
      priorityMenu.querySelector('[checked="true"]').removeAttribute('checked');
      priorityMenu.querySelector('[value="' + msgCompFields.priority + '"]').setAttribute('checked', 'true');
    }
  }
}

function updatePriorityToolbarButton(newPriorityValue)
{
  var prioritymenu = document.getElementById('priorityMenu-button');
  if (prioritymenu)
    prioritymenu.value = newPriorityValue;
}

function PriorityMenuSelect(target)
{
  if (gMsgCompose)
  {
    var msgCompFields = gMsgCompose.compFields;
    if (msgCompFields)
      msgCompFields.priority = target.getAttribute('value');

    // keep priority toolbar button in synch with possible changes via the menu item
    updatePriorityToolbarButton(target.getAttribute('value'));
  }
}

function OutputFormatMenuSelect(target)
{
  if (gMsgCompose)
  {
    var msgCompFields = gMsgCompose.compFields;
    var toolbar = document.getElementById("FormatToolbar");
    var format_menubar = document.getElementById("formatMenu");
    var insert_menubar = document.getElementById("insertMenu");
    var show_menuitem = document.getElementById("menu_showFormatToolbar");

    if (msgCompFields)
      switch (target.getAttribute('id'))
      {
        case "format_auto":  gSendFormat = nsIMsgCompSendFormat.AskUser;     break;
        case "format_plain": gSendFormat = nsIMsgCompSendFormat.PlainText;   break;
        case "format_html":  gSendFormat = nsIMsgCompSendFormat.HTML;        break;
        case "format_both":  gSendFormat = nsIMsgCompSendFormat.Both;        break;
      }
    gHideMenus = (gSendFormat == nsIMsgCompSendFormat.PlainText);
    format_menubar.hidden = gHideMenus;
    insert_menubar.hidden = gHideMenus;
    show_menuitem.hidden = gHideMenus;
    toolbar.hidden = gHideMenus ||
      (show_menuitem.getAttribute("checked") == "false");
  }
}

// walk through the recipients list and add them to the inline spell checker ignore list
function addRecipientsToIgnoreList(aAddressesToAdd)
{
  if (gSpellChecker.enabled)
  {
    // break the list of potentially many recipients back into individual names
    var emailAddresses = {};
    var names = {};
    var fullNames = {};
    let numAddresses = MailServices.headerParser.parseHeadersWithArray(aAddressesToAdd, emailAddresses, names, fullNames);
    if (!names)
      return;
    var tokenizedNames = new Array();

    // each name could consist of multiple word delimited by either commas or spaces. i.e. Green Lantern
    // or Lantern,Green. Tokenize on comma first, then tokenize again on spaces.
    for (let name in names.value)
    {
      if (!names.value[name])
        continue;
      let splitNames = names.value[name].split(',');
      for (let i = 0; i < splitNames.length; i++)
      {
        // now tokenize off of white space
        let splitNamesFromWhiteSpaceArray = splitNames[i].split(' ');
        for (let whiteSpaceIndex = 0; whiteSpaceIndex < splitNamesFromWhiteSpaceArray.length; whiteSpaceIndex++)
          if (splitNamesFromWhiteSpaceArray[whiteSpaceIndex])
            tokenizedNames.push(splitNamesFromWhiteSpaceArray[whiteSpaceIndex]);
      }
    }


    if (gSpellChecker.mInlineSpellChecker.spellCheckPending)
    {
      // spellchecker is enabled, but we must wait for its init to complete
      Services.obs.addObserver(function observe(subject, topic, data) {
        if (subject == gMsgCompose.editor)
        {
          Services.obs.removeObserver(observe, topic);
          gSpellChecker.mInlineSpellChecker.ignoreWords(tokenizedNames, tokenizedNames.length);
        }
      }, "inlineSpellChecker-spellCheck-ended", false);
    }
    else
    {
      gSpellChecker.mInlineSpellChecker.ignoreWords(tokenizedNames, tokenizedNames.length);
    }
  }
}

function onAddressColCommand(aAddressWidgetId)
{
  gContentChanged = true;
  awSetAutoComplete(aAddressWidgetId.slice(aAddressWidgetId.lastIndexOf('#') + 1));
  updateSendCommands(true);
}

/**
 * Called if the list of recipients changed in any way.
 *
 * @param aAutomatic  Set to true if the change of recipients was invoked
 *                    programatically and should not be considered a change
 *                    of message content.
 */
function onRecipientsChanged(aAutomatic)
{
  if (!aAutomatic) {
    gContentChanged = true;
    setupAutocomplete();
  }
  updateSendCommands(true);
}

function InitLanguageMenu()
{
  var languageMenuList = document.getElementById('languageMenuList');
  if (!languageMenuList)
    return;

  var spellChecker = Components.classes['@mozilla.org/spellchecker/engine;1']
                               .getService(mozISpellCheckingEngine);
  var o1 = {};
  var o2 = {};

  // Get the list of dictionaries from
  // the spellchecker.

  spellChecker.getDictionaryList(o1, o2);

  var dictList = o1.value;
  var count    = o2.value;

  // If dictionary count hasn't changed then no need to update the menu.
  if (sDictCount == count)
    return;

  // Store current dictionary count.
  sDictCount = count;

  // Load the string bundle that will help us map
  // RFC 1766 strings to UI strings.
  var languageBundle = document.getElementById("languageBundle");
  var isoStrArray;
  var langId;
  var langLabel;

  for (let i = 0; i < count; i++)
  {
    try
    {
      langId = dictList[i];
      isoStrArray = dictList[i].split(/[-_]/);

      if (languageBundle && isoStrArray[0])
        langLabel = languageBundle.getString(isoStrArray[0].toLowerCase());

      // the user needs to be able to distinguish between the UK English dictionary
      // and say the United States English Dictionary. If we have a isoStr value then
      // wrap it in parentheses and append it to the menu item string. i.e.
      // English (US) and English (UK)
      if (!langLabel)
        langLabel = langId;
      // if we have a language ID like US or UK, append it to the menu item, and any sub-variety
      else if (isoStrArray.length > 1 && isoStrArray[1]) {
        langLabel += ' (' + isoStrArray[1];
        if (isoStrArray.length > 2 && isoStrArray[2])
          langLabel += '-' + isoStrArray[2];
        langLabel += ')';
      }
    }
    catch (ex)
    {
      // getString throws an exception when a key is not found in the
      // bundle. In that case, just use the original dictList string.
      langLabel = langId;
    }
    dictList[i] = [langLabel, langId];
  }

  // sort by locale-aware collation
  dictList.sort(
    function compareFn(a, b)
    {
      return a[0].localeCompare(b[0]);
    }
  );

  // Remove any languages from the list.
  while (languageMenuList.hasChildNodes())
    languageMenuList.lastChild.remove();

  for (let i = 0; i < count; i++)
  {
    var item = document.createElement("menuitem");
    item.setAttribute("label", dictList[i][0]);
    item.setAttribute("value", dictList[i][1]);
    item.setAttribute('type', 'radio');
    languageMenuList.appendChild(item);
  }
}

function OnShowDictionaryMenu(aTarget)
{
  InitLanguageMenu();
  let spellChecker = gSpellChecker.mInlineSpellChecker.spellChecker;
  let curLang = spellChecker.GetCurrentDictionary();
  if (!curLang || curLang != document.documentElement.getAttribute("lang")) {
    // Looks like the active dictionary got removed, or something is
    // inconsistent. In this case do not check anything, so the user can select
    // another dictionary.
    return;
  }
  let language = aTarget.querySelector('[value="' + curLang + '"]');
  if (language)
    language.setAttribute("checked", true);
}

function updateLanguageInStatusBar()
{
  InitLanguageMenu();
  let languageMenuList = document.getElementById("languageMenuList");
  let statusLanguageText = document.getElementById("statusLanguageText");
  if (!languageMenuList || !statusLanguageText) {
    return;
  }

  let language = document.documentElement.getAttribute("lang");
  let item = languageMenuList.firstChild;

  // No status display, if there is only one or no spelling dictionary available.
  if (item == languageMenuList.lastChild) {
    statusLanguageText.collapsed = true;
    statusLanguageText.label = "";
    return;
  }

  statusLanguageText.collapsed = false;
  while (item) {
    if (item.getAttribute("value") == language) {
      statusLanguageText.label = item.getAttribute("label");
      break;
    }
    item = item.nextSibling;
  }
}

function ChangeLanguage(event)
{
  // We need to change the dictionary language and if we are using inline spell check,
  // recheck the message

  var spellChecker = gSpellChecker.mInlineSpellChecker.spellChecker;
  if (spellChecker.GetCurrentDictionary() != event.target.value)
  {
    spellChecker.SetCurrentDictionary(event.target.value);

    // Update the document language as well (needed to synchronise
    // the subject).
    document.documentElement.setAttribute("lang", event.target.value);

    // now check the document over again with the new dictionary
    if (gSpellChecker.enabled) {
      gSpellChecker.mInlineSpellChecker.spellCheckRange(null);

      // Also force a recheck of the subject. If for some reason the spell
      // checker isn't ready yet, don't auto-create it, hence pass 'false'.
      var inlineSpellChecker =
        GetMsgSubjectElement().editor.getInlineSpellChecker(false);
      if (inlineSpellChecker) {
        inlineSpellChecker.spellCheckRange(null);
      }
    }
  }
  event.stopPropagation();
}

function ToggleReturnReceipt(target)
{
    var msgCompFields = gMsgCompose.compFields;
    if (msgCompFields)
    {
        msgCompFields.returnReceipt = ! msgCompFields.returnReceipt;
        target.setAttribute('checked', msgCompFields.returnReceipt);
        gReceiptOptionChanged = true;
    }
}

function ToggleDSN(target)
{
    var msgCompFields = gMsgCompose.compFields;
    if (msgCompFields)
    {
        msgCompFields.DSN = ! msgCompFields.DSN;
        target.setAttribute('checked', msgCompFields.DSN);
        gDSNOptionChanged = true;
    }
}

function ToggleAttachVCard(target)
{
  var msgCompFields = gMsgCompose.compFields;
  if (msgCompFields)
  {
    msgCompFields.attachVCard = ! msgCompFields.attachVCard;
    target.setAttribute('checked', msgCompFields.attachVCard);
    gAttachVCardOptionChanged = true;
  }
}

/**
 * Toggles or sets the status of manual Attachment Reminder, i.e. whether
 * the user will get the "Attachment Reminder" alert before sending or not.
 * Toggles checkmark on "Remind me later" menuitem and internal
 * gManualAttachmentReminder flag accordingly.
 *
 * @param aState (optional) true = activate reminder.
 *                          false = deactivate reminder.
 *                          (default) = toggle reminder state.
 */
function toggleAttachmentReminder(aState = !gManualAttachmentReminder)
{
  gManualAttachmentReminder = aState;
  document.getElementById("cmd_remindLater")
          .setAttribute("checked", aState);
  gMsgCompose.compFields.attachmentReminder = aState;
  manageAttachmentNotification(false);
}

function ClearIdentityListPopup(popup)
{
  if (popup)
    while (popup.hasChildNodes())
      popup.lastChild.remove();
}

function FillIdentityList(menulist)
{
  let accounts = allAccountsSorted(true);

  let accountHadSeparator = false;
  let firstAccountWithIdentities = true;
  for (let acc = 0; acc < accounts.length; acc++) {
    let account = accounts[acc];
    let identities = toArray(fixIterator(account.identities,
                                         Components.interfaces.nsIMsgIdentity));

    if (identities.length == 0)
      continue;

    let needSeparator = (identities.length > 1);
    if (needSeparator || accountHadSeparator) {
      // Separate identities from this account from the previous
      // account's identities if there is more than 1 in the current
      // or previous account.
      if (!firstAccountWithIdentities) {
        // only if this is not the first account shown
        let separator = document.createElement("menuseparator");
        menulist.menupopup.appendChild(separator);
      }
      accountHadSeparator = needSeparator;
    }
    firstAccountWithIdentities = false;

    for (let i = 0; i < identities.length; i++) {
      let identity = identities[i];
      let address = MailServices.headerParser.makeMailboxObject(
        identity.fullName, identity.email).toString();
      let item = menulist.appendItem(identity.identityName,
                                     address,
                                     account.incomingServer.prettyName);
      item.setAttribute("identitykey", identity.key);
      item.setAttribute("accountkey", account.key);
      if (i == 0) {
        // Mark the first identity as default.
        item.setAttribute("default", "true");
      }
    }
  }

  menulist.menupopup.appendChild(document.createElement("menuseparator"));
  menulist.menupopup.appendChild(document.createElement("menuitem"))
          .setAttribute("command", "cmd_customizeFromAddress");
}

function getCurrentAccountKey()
{
    // get the accounts key
    var identityList = document.getElementById("msgIdentity");
    return identityList.selectedItem.getAttribute("accountkey");
}

function getCurrentIdentityKey()
{
  // get the identity key
  var identityList = GetMsgIdentityElement();
  return identityList.selectedItem.getAttribute("identitykey");
}

function getIdentityForKey(key)
{
    return MailServices.accounts.getIdentity(key);
}

function getCurrentIdentity()
{
  return getIdentityForKey(getCurrentIdentityKey());
}

function AdjustFocus()
{
  //dump("XXX adjusting focus\n");
  var element = awGetInputElement(awGetNumberOfRecipients());
  if (element.value == "") {
      //dump("XXX focus on address\n");
      awSetFocus(awGetNumberOfRecipients(), element);
  }
  else
  {
      element = GetMsgSubjectElement();
      if (element.value == "") {
        //dump("XXX focus on subject\n");
        element.focus();
      }
      else {
        //dump("XXX focus on body\n");
        SetMsgBodyFrameFocus();
      }
  }
}

function SetComposeWindowTitle()
{
  var newTitle = GetMsgSubjectElement().value;

  if (newTitle == "" )
    newTitle = getComposeBundle().getString("defaultSubject");

  newTitle += GetCharsetUIString();
  document.title = getComposeBundle().getString("windowTitlePrefix") + " " + newTitle;
}

// Check for changes to document and allow saving before closing
// This is hooked up to the OS's window close widget (e.g., "X" for Windows)
function ComposeCanClose()
{
  // No open compose window?
  if (!gMsgCompose)
    return true;

  // Do this early, so ldap sessions have a better chance to
  // cleanup after themselves.
  if (gSendOperationInProgress || gSaveOperationInProgress)
  {
    let result;

    let brandBundle = document.getElementById("brandBundle");
    let brandShortName = brandBundle.getString("brandShortName");
    let promptTitle = gSendOperationInProgress ?
      getComposeBundle().getString("quitComposeWindowTitle") :
      getComposeBundle().getString("quitComposeWindowSaveTitle");
    let promptMsg = gSendOperationInProgress ?
      getComposeBundle().getFormattedString("quitComposeWindowMessage2",
        [brandShortName], 1) :
      getComposeBundle().getFormattedString("quitComposeWindowSaveMessage",
        [brandShortName], 1);
    let quitButtonLabel = getComposeBundle().getString("quitComposeWindowQuitButtonLabel2");
    let waitButtonLabel = getComposeBundle().getString("quitComposeWindowWaitButtonLabel2");

    result = Services.prompt.confirmEx(window, promptTitle, promptMsg,
        (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) +
        (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_1),
        waitButtonLabel, quitButtonLabel, null, null, {value:0});

    if (result == 1)
    {
      gMsgCompose.abort();
      return true;
    }
    return false;
  }

  // Returns FALSE only if user cancels save action
  if (gContentChanged || gMsgCompose.bodyModified || gAutoSaveKickedIn)
  {
    // call window.focus, since we need to pop up a dialog
    // and therefore need to be visible (to prevent user confusion)
    window.focus();
    let draftFolderURI = gCurrentIdentity.draftFolder;
    let draftFolderName = MailUtils.getFolderForURI(draftFolderURI).prettyName;
    let result = Services.prompt
                         .confirmEx(window,
                                    getComposeBundle().getString("saveDlogTitle"),
                                    getComposeBundle().getFormattedString("saveDlogMessages",[draftFolderName]),
                                    (Services.prompt.BUTTON_TITLE_SAVE * Services.prompt.BUTTON_POS_0) +
                                    (Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1) +
                                    (Services.prompt.BUTTON_TITLE_DONT_SAVE * Services.prompt.BUTTON_POS_2),
                                    null, null, null,
                                    null, {value:0});
    switch (result)
    {
      case 0: //Save
        // Since we're going to save the message, we tell toolkit that
        // the close command failed, by returning false, and then
        // we close the window ourselves after the save is done.
        gCloseWindowAfterSave = true;
        // We catch the exception because we need to tell toolkit that it
        // shouldn't close the window, because we're going to close it
        // ourselves. If we don't tell toolkit that, and then close the window
        // ourselves, the toolkit code that keeps track of the open windows
        // gets off by one and the app can close unexpectedly on os's that
        // shutdown the app when the last window is closed.
        try {
          GenericSendMessage(nsIMsgCompDeliverMode.AutoSaveAsDraft);
        }
        catch (ex) {
          Components.utils.reportError(ex);
        }
        return false;
      case 1: //Cancel
        return false;
      case 2: //Don't Save
        // don't delete the draft if we didn't start off editing a draft
        // and the user hasn't explicitly saved it.
        if (!gEditingDraft && gAutoSaveKickedIn)
          RemoveDraft();
        break;
    }
  }

  return true;
}

function RemoveDraft()
{
  try
  {
    var draftUri = gMsgCompose.compFields.draftId;
    var msgKey = draftUri.substr(draftUri.indexOf('#') + 1);
    var rdf = Components.classes['@mozilla.org/rdf/rdf-service;1']
                        .getService(Components.interfaces.nsIRDFService);

    var folder = rdf.GetResource(gMsgCompose.savedFolderURI)
                    .QueryInterface(Components.interfaces.nsIMsgFolder);
    try {
      if (folder.flags & Components.interfaces.nsMsgFolderFlags.Drafts)
      {
        var msgs = Components.classes["@mozilla.org/array;1"].
            createInstance(Components.interfaces.nsIMutableArray);
        msgs.appendElement(folder.GetMessageHeader(msgKey), false);
        folder.deleteMessages(msgs, null, true, false, null, false);
      }
    }
    catch (ex) // couldn't find header - perhaps an imap folder.
    {
      var imapFolder = folder.QueryInterface(Components.interfaces.nsIMsgImapMailFolder);
      var keyArray = new Array;
      keyArray[0] = msgKey;
      imapFolder.storeImapFlags(8, true, keyArray, 1, null);
    }
  } catch (ex) {}
}

function SetContentAndBodyAsUnmodified()
{
  gMsgCompose.bodyModified = false;
  gContentChanged = false;
}

function MsgComposeCloseWindow(recycleIt)
{
  if (gMsgCompose)
    gMsgCompose.CloseWindow(recycleIt);
  else
    window.close();
}

function GetLastAttachDirectory()
{
  var lastDirectory;

  try {
    lastDirectory = Services.prefs
                            .getComplexValue(kComposeAttachDirPrefName,
                                             Components.interfaces.nsIFile);
  }
  catch (ex) {
    // this will fail the first time we attach a file
    // as we won't have a pref value.
    lastDirectory = null;
  }

  return lastDirectory;
}

// attachedLocalFile must be a nsILocalFile
function SetLastAttachDirectory(attachedLocalFile)
{
  try {
    let file = attachedLocalFile.QueryInterface(Components.interfaces.nsIFile);
    let parent = file.parent.QueryInterface(Components.interfaces.nsIFile);

    Services.prefs.setComplexValue(kComposeAttachDirPrefName,
                                   Components.interfaces.nsIFile, parent);
  }
  catch (ex) {
    dump("error: SetLastAttachDirectory failed: " + ex + "\n");
  }
}

function AttachFile()
{
  //Get file using nsIFilePicker and convert to URL
  var fp = Components.classes["@mozilla.org/filepicker;1"]
                     .createInstance(nsIFilePicker);
  fp.init(window, getComposeBundle().getString("chooseFileToAttach"),
          nsIFilePicker.modeOpenMultiple);

  var lastDirectory = GetLastAttachDirectory();
  if (lastDirectory)
    fp.displayDirectory = lastDirectory;

  fp.appendFilters(nsIFilePicker.filterAll);
  if (fp.show() == nsIFilePicker.returnOK)
  {
    if (!fp.files)
      return;
    let file;
    let attachments = [];

    for (file in fixIterator(fp.files, Components.interfaces.nsILocalFile))
      attachments.push(FileToAttachment(file));

    AddAttachments(attachments);
    SetLastAttachDirectory(file);
  }
}

/**
 * Convert an nsILocalFile instance into an nsIMsgAttachment.
 *
 * @param file the nsILocalFile
 * @return an attachment pointing to the file
 */
function FileToAttachment(file)
{
  let fileHandler = Services.io.getProtocolHandler("file")
                            .QueryInterface(Components.interfaces.nsIFileProtocolHandler);
  let attachment = Components.classes["@mozilla.org/messengercompose/attachment;1"]
                             .createInstance(Components.interfaces.nsIMsgAttachment);

  attachment.url = fileHandler.getURLSpecFromFile(file);
  attachment.size = file.fileSize;
  return attachment;
}

/**
 * Add a list of attachment objects as attachments. The attachment URLs must be
 * set.
 *
 * @param aAttachments an iterable list of nsIMsgAttachment objects to add as
 *        attachments. Anything iterable with fixIterator is accepted.
 * @param aCallback an optional callback function called immediately after
 *        adding each attachment. Takes one argument: the newly-added
 *        <attachmentitem> node.
 */
function AddAttachments(aAttachments, aCallback)
{
  let bucket = document.getElementById("attachmentBucket");
  let addedAttachments = Components.classes["@mozilla.org/array;1"]
                                   .createInstance(Components.interfaces.nsIMutableArray);
  let items = [];

  for (let attachment in fixIterator(aAttachments,
                                     Components.interfaces.nsIMsgAttachment)) {
    if (!(attachment && attachment.url) ||
        DuplicateFileAlreadyAttached(attachment.url))
      continue;

    if (!attachment.name)
      attachment.name = gMsgCompose.AttachmentPrettyName(attachment.url, null);

    // For security reasons, don't allow *-message:// uris to leak out.
    // We don't want to reveal the .slt path (for mailbox://), or the username
    // or hostname.
    if (/^mailbox-message:|^imap-message:|^news-message:/i.test(attachment.name))
      attachment.name = getComposeBundle().getString("messageAttachmentSafeName");
    // Don't allow file or mail/news protocol uris to leak out either.
    else if (/^file:|^mailbox:|^imap:|^s?news:/i.test(attachment.name))
      attachment.name = getComposeBundle().getString("partAttachmentSafeName");

    let item = bucket.appendItem(attachment);
    addedAttachments.appendElement(attachment, false);

    if (attachment.size != -1)
      gAttachmentsSize += attachment.size;

    try {
      item.setAttribute("tooltiptext", decodeURI(attachment.url));
    }
    catch(e) {
      item.setAttribute("tooltiptext", attachment.url);
    }
    item.addEventListener("command", OpenSelectedAttachment, false);

    if (attachment.sendViaCloud) {
      try {
        let cloudProvider = cloudFileAccounts.getAccount(attachment.cloudProviderKey);
        item.cloudProvider = cloudProvider;
        item.image = cloudProvider.iconClass;
        item.originalUrl = attachment.url;
      } catch (ex) {dump(ex);}
    }
    else {
      // For local file urls, we are better off using the full file url because
      // moz-icon will actually resolve the file url and get the right icon from
      // the file url. All other urls, we should try to extract the file name from
      // them. This fixes issues where an icon wasn't showing up if you dragged a
      // web url that had a query or reference string after the file name and for
      // mailnews urls where the filename is hidden in the url as a &filename=
      // part.
      let url = Services.io.newURI(attachment.url, null, null);
      if (url instanceof Components.interfaces.nsIURL &&
          url.fileName && !url.schemeIs("file"))
        item.image = "moz-icon://" + url.fileName;
      else
        item.image = "moz-icon:" + attachment.url;
      }

    items.push(item);

    if (aCallback)
      aCallback(item);

    AttachmentsChanged();
  }

  if (addedAttachments.length) {
    gContentChanged = true;

    UpdateAttachmentBucket(true);
    dispatchAttachmentBucketEvent("attachments-added", addedAttachments);
  }

  return items;
}

function MessageGetNumSelectedAttachments()
{
  var bucketList = document.getElementById("attachmentBucket");
  return (bucketList) ? bucketList.selectedCount : 0;
}

function AttachPage()
{
  let result = {value:"http://"};
  if (Services.prompt.prompt(window,
                      getComposeBundle().getString("attachPageDlogTitle"),
                      getComposeBundle().getString("attachPageDlogMessage"),
                      result,
                      null,
                      {value:0}))
  {
    if (result.value.length <= "http://".length)
    {
      // Nothing filled, just show the dialog again.
      AttachPage();
      return;
    }

    let attachment = Components.classes["@mozilla.org/messengercompose/attachment;1"]
                               .createInstance(Components.interfaces.nsIMsgAttachment);
    attachment.url = result.value;
    AddAttachments([attachment]);
  }
}

/**
 * Check if the given fileURL already exists in the attachment bucket.
 * @param fileURL the URL (as a String) of the file to check
 * @return true if the fileURL is already attached
 */
function DuplicateFileAlreadyAttached(fileURL)
{
  var bucket = document.getElementById('attachmentBucket');
  let rowCount = bucket.getRowCount();
  for (let i = 0; i < rowCount; i++)
  {
    let attachment = bucket.getItemAtIndex(i).attachment;
    if (attachment && attachment.url == fileURL)
      return true;
  }
  return false;
}

function Attachments2CompFields(compFields)
{
  var bucket = document.getElementById('attachmentBucket');

  //First, we need to clear all attachment in the compose fields
  compFields.removeAttachments();

  let rowCount = bucket.getRowCount();
  for (let i = 0; i < rowCount; i++)
  {
    let attachment = bucket.getItemAtIndex(i).attachment;
    if (attachment)
      compFields.addAttachment(attachment);
  }
}

function RemoveAllAttachments()
{
  let bucket = document.getElementById("attachmentBucket");
  let removedAttachments = Components.classes["@mozilla.org/array;1"]
                                     .createInstance(Components.interfaces.nsIMutableArray);

  while (bucket.getRowCount())
  {
    let child = bucket.removeItemAt(bucket.getRowCount() - 1);

    removedAttachments.appendElement(child.attachment, false);
    // Let's release the attachment object hold by the node else it won't go
    // away until the window is destroyed
    child.attachment = null;
  }

  dispatchAttachmentBucketEvent("attachments-removed", removedAttachments);
  UpdateAttachmentBucket(false);
  AttachmentsChanged();
}

/**
 * Display/hide and update the content of the attachment bucket (specifically
 * the total file size of the attachments and the number of current attachments)
 *
 * @param aShowBucket true if the bucket should be shown, false otherwise
 */
function UpdateAttachmentBucket(aShowBucket)
{
  if (aShowBucket) {
    var count = document.getElementById("attachmentBucket").getRowCount();

    var words = getComposeBundle().getString("attachmentCount");
    var countStr = PluralForm.get(count, words).replace("#1", count);

    document.getElementById("attachmentBucketCount").value = countStr;
    document.getElementById("attachmentBucketSize").value =
      gMessenger.formatFileSize(gAttachmentsSize);
  }

  document.getElementById("attachments-box").collapsed = !aShowBucket;
  document.getElementById("attachmentbucket-sizer").collapsed = !aShowBucket;
}

function RemoveSelectedAttachment()
{
  let bucket = document.getElementById("attachmentBucket");
  if (bucket.selectedItems.length > 0) {
    let fileHandler = Services.io.getProtocolHandler("file")
                              .QueryInterface(Components.interfaces.nsIFileProtocolHandler);
    let removedAttachments = Components.classes["@mozilla.org/array;1"]
                                       .createInstance(Components.interfaces.nsIMutableArray);

    for (let i = bucket.selectedCount - 1; i >= 0; i--) {
      let item = bucket.removeItemAt(bucket.getIndexOfItem(bucket.getSelectedItem(i)));
      if (item.attachment.size != -1) {
        gAttachmentsSize -= item.attachment.size;
        UpdateAttachmentBucket(true);
      }

      if (item.attachment.sendViaCloud && item.cloudProvider) {
        let originalUrl = item.originalUrl;
        if (!originalUrl)
          originalUrl = item.attachment.url;
        let file = fileHandler.getFileFromURLSpec(originalUrl);
        if (item.uploading)
          item.cloudProvider.cancelFileUpload(file);
        else
          item.cloudProvider.deleteFile(file,
            new deletionListener(item.attachment, item.cloudProvider));
      }

      removedAttachments.appendElement(item.attachment, false);
      // Let's release the attachment object held by the node else it won't go
      // away until the window is destroyed
      item.attachment = null;
    }

    gContentChanged = true;
    dispatchAttachmentBucketEvent("attachments-removed", removedAttachments);
  }
  AttachmentsChanged();
}

function RenameSelectedAttachment()
{
  let bucket = document.getElementById("attachmentBucket");
  if (bucket.selectedItems.length != 1)
    return; // not one attachment selected

  let item = bucket.getSelectedItem(0);
  let attachmentName = {value: item.attachment.name};
  if (Services.prompt
              .prompt(window,
                      getComposeBundle().getString("renameAttachmentTitle"),
                      getComposeBundle().getString("renameAttachmentMessage"),
                      attachmentName,
                      null,
                      {value: 0}))
  {
    if (attachmentName.value == "")
      return; // name was not filled, bail out

    let originalName = item.attachment.name;
    item.attachment.name = attachmentName.value;
    item.setAttribute("name", attachmentName.value);

    gContentChanged = true;

    let event = document.createEvent("CustomEvent");
    event.initCustomEvent("attachment-renamed", true, true, originalName);
    item.dispatchEvent(event);
  }
}

function AttachmentElementHasItems()
{
  var element = document.getElementById("attachmentBucket");
  return element ? element.getRowCount() : 0;
}

function OpenSelectedAttachment()
{
  let child;
  let bucket = document.getElementById("attachmentBucket");
  if (bucket.selectedItems.length == 1)
  {
    let attachmentUrl = bucket.getSelectedItem(0).attachment.url;

    let messagePrefix = /^mailbox-message:|^imap-message:|^news-message:/i;
    if (messagePrefix.test(attachmentUrl))
    {
      // we must be dealing with a forwarded attachment, treat this special
      let msgHdr = gMessenger.messageServiceFromURI(attachmentUrl).messageURIToMsgHdr(attachmentUrl);
      if (msgHdr)
        MailUtils.openMessageInNewWindow(msgHdr);
    }
    else
    {
      // turn the url into a nsIURL object then open it

      let url = Services.io.newURI(attachmentUrl, null, null);
      url = url.QueryInterface( Components.interfaces.nsIURL );

      if (url)
      {
        let channel = Services.io.newChannelFromURI2(url,
                                                     null,
                                                     Services.scriptSecurityManager.getSystemPrincipal(),
                                                     null,
                                                     Components.interfaces.nsILoadInfo.SEC_NORMAL,
                                                     Components.interfaces.nsIContentPolicy.TYPE_OTHER);
        if (channel)
        {
          let uriLoader = Components.classes["@mozilla.org/uriloader;1"].getService(Components.interfaces.nsIURILoader);
          uriLoader.openURI(channel, true, new nsAttachmentOpener());
        } // if channel
      } // if url
    }
  } // if one attachment selected
}

function nsAttachmentOpener()
{
}

nsAttachmentOpener.prototype =
{
  QueryInterface: function(iid)
  {
    if (iid.equals(Components.interfaces.nsIURIContentListener) ||
        iid.equals(Components.interfaces.nsIInterfaceRequestor) ||
        iid.equals(Components.interfaces.nsISupports))
        return this;
    throw Components.results.NS_NOINTERFACE;
  },

  onStartURIOpen: function(uri)
  {
    return false;
  },

  doContent: function(contentType, isContentPreferred, request, contentHandler)
  {
    return false;
  },

  isPreferred: function(contentType, desiredContentType)
  {
    return false;
  },

  canHandleContent: function(contentType, isContentPreferred, desiredContentType)
  {
    return false;
  },

  getInterface: function(iid)
  {
    if (iid.equals(Components.interfaces.nsIDOMWindow))
      return window;
    else
      return this.QueryInterface(iid);
  },

  loadCookie: null,
  parentContentListener: null
}

/**
 * Check what to do with HTML message according to what preference we have
 * stored for the recipients.
 *
 * @param convertible  An nsIMsgCompConvertible constant describing
 *                     message convertibility to plain text.
 */
function DetermineHTMLAction(convertible)
{
  if (!gMsgCompose.composeHTML)
    return nsIMsgCompSendFormat.PlainText;

  if (gSendFormat == nsIMsgCompSendFormat.AskUser)
    return gMsgCompose.determineHTMLAction(convertible);

  return gSendFormat;
}

/**
 * Expands mailinglists found in the recipient fields.
 */
function expandRecipients()
{
  gMsgCompose.expandMailingLists();
}

function DetermineConvertibility()
{
    if (!gMsgCompose.composeHTML)
        return nsIMsgCompConvertible.Plain;

    try {
        return gMsgCompose.bodyConvertible();
    } catch(ex) {}
    return nsIMsgCompConvertible.No;
}

/**
 * Hides addressing options (To, CC, Bcc, Newsgroup, Followup-To, etc.)
 * that are not relevant for the account type used for sending.
 *
 * @param aAccountKey  Key of the account that is currently selected
 *                     as the sending account.
 */
function hideIrrelevantAddressingOptions(aAccountKey)
{
  let hideNews = true;
  for (let account in fixIterator(MailServices.accounts.accounts,
                                  Components.interfaces.nsIMsgAccount)) {
    if (account.incomingServer.type == "nntp")
      hideNews = false;
  }
  // If there is no News (NNTP) account existing then
  // hide the Newsgroup and Followup-To recipient type in all the menulists.
  let addrWidget = document.getElementById("addressingWidget");
  // Only really touch the News related items we know about.
  let newsTypes = addrWidget
    .querySelectorAll('menuitem[value="addr_newsgroups"], menuitem[value="addr_followup"]');
  // Collapsing the menuitem only prevents it getting chosen, it does not
  // affect the menulist widget display when Newsgroup is already selected.
  for (let item of newsTypes) {
    item.collapsed = hideNews;
  }
}

function LoadIdentity(startup)
{
    var identityElement = document.getElementById("msgIdentity");
    var prevIdentity = gCurrentIdentity;

    if (identityElement) {
        var idKey = identityElement.selectedItem.getAttribute("identitykey");
        gCurrentIdentity = MailServices.accounts.getIdentity(idKey);

        let accountKey = null;
        // Set the account key value on the menu list.
        if (identityElement.selectedItem) {
          accountKey = identityElement.selectedItem.getAttribute("accountkey");
          identityElement.setAttribute("accountkey", accountKey);
          hideIrrelevantAddressingOptions(accountKey);
        }

        let maxRecipients = awGetMaxRecipients();
        for (let i = 1; i <= maxRecipients; i++)
        {
          let params = JSON.parse(awGetInputElement(i).searchParam);
          params.idKey = idKey;
          params.accountKey = accountKey;
          awGetInputElement(i).searchParam = JSON.stringify(params);
        }

        if (!startup && prevIdentity && idKey != prevIdentity.key)
        {
          var prevReplyTo = prevIdentity.replyTo;
          var prevCc = "";
          var prevBcc = "";
          var prevReceipt = prevIdentity.requestReturnReceipt;
          var prevDSN = prevIdentity.DSN;
          var prevAttachVCard = prevIdentity.attachVCard;

          if (prevIdentity.doCc)
            prevCc += prevIdentity.doCcList;

          if (prevIdentity.doBcc)
            prevBcc += prevIdentity.doBccList;

          var newReplyTo = gCurrentIdentity.replyTo;
          var newCc = "";
          var newBcc = "";
          var newReceipt = gCurrentIdentity.requestReturnReceipt;
          var newDSN = gCurrentIdentity.DSN;
          var newAttachVCard = gCurrentIdentity.attachVCard;

          if (gCurrentIdentity.doCc)
            newCc += gCurrentIdentity.doCcList;

          if (gCurrentIdentity.doBcc)
            newBcc += gCurrentIdentity.doBccList;

          var needToCleanUp = false;
          var msgCompFields = gMsgCompose.compFields;

          if (!gReceiptOptionChanged &&
              prevReceipt == msgCompFields.returnReceipt &&
              prevReceipt != newReceipt)
          {
            msgCompFields.returnReceipt = newReceipt;
            document.getElementById("returnReceiptMenu").setAttribute('checked',msgCompFields.returnReceipt);
          }

          if (!gDSNOptionChanged &&
              prevDSN == msgCompFields.DSN &&
              prevDSN != newDSN)
          {
            msgCompFields.DSN = newDSN;
            document.getElementById("dsnMenu").setAttribute('checked',msgCompFields.DSN);
          }

          if (!gAttachVCardOptionChanged &&
              prevAttachVCard == msgCompFields.attachVCard &&
              prevAttachVCard != newAttachVCard)
          {
            msgCompFields.attachVCard = newAttachVCard;
            document.getElementById("cmd_attachVCard").setAttribute('checked',msgCompFields.attachVCard);
          }

          if (newReplyTo != prevReplyTo)
          {
            needToCleanUp = true;
            if (prevReplyTo != "")
              awRemoveRecipients(msgCompFields, "addr_reply", prevReplyTo);
            if (newReplyTo != "")
              awAddRecipients(msgCompFields, "addr_reply", newReplyTo);
          }

          if (newCc != prevCc)
          {
            needToCleanUp = true;
            if (prevCc != "")
              awRemoveRecipients(msgCompFields, "addr_cc", prevCc);
            if (newCc != "")
              awAddRecipients(msgCompFields, "addr_cc", newCc);
          }

          if (newBcc != prevBcc)
          {
            needToCleanUp = true;
            if (prevBcc != "")
              awRemoveRecipients(msgCompFields, "addr_bcc", prevBcc);
            if (newBcc != "")
              awAddRecipients(msgCompFields, "addr_bcc", newBcc);
          }

          if (needToCleanUp)
            awCleanupRows();

          try {
            gMsgCompose.identity = gCurrentIdentity;
          } catch (ex) { dump("### Cannot change the identity: " + ex + "\n");}

          var event = document.createEvent('Events');
          event.initEvent('compose-from-changed', false, true);
          document.getElementById("msgcomposeWindow").dispatchEvent(event);
        }

      if (!startup) {
          if (getPref("mail.autoComplete.highlightNonMatches"))
            document.getElementById('addressCol2#1').highlightNonMatches = true;

          addRecipientsToIgnoreList(gCurrentIdentity.identityName);  // only do this if we aren't starting up....it gets done as part of startup already
          // If the From field is editable, reset the address from the identity.
          if (identityElement.editable)
          {
            identityElement.value = identityElement.selectedItem.value;
            identityElement.inputField.placeholder = getComposeBundle().getFormattedString("msgIdentityPlaceholder", [identityElement.selectedItem.value]);
          }
      }
    }
}

function MakeFromFieldEditable(ignoreWarning)
{
  if (!ignoreWarning && !getPref("mail.compose.warned_about_customize_from"))
  {
    var check = { value: false };
    if (Services.prompt.confirmEx(window,
          getComposeBundle().getString("customizeFromAddressTitle"),
          getComposeBundle().getString("customizeFromAddressWarning"),
          Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_OK +
          Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_CANCEL +
          Services.prompt.BUTTON_POS_1_DEFAULT,
          null, null, null,
          getComposeBundle().getString("customizeFromAddressIgnore"),
          check) != 0)
      return;
    Services.prefs.setBoolPref("mail.compose.warned_about_customize_from", check.value);
  }

  var customizeMenuitem = document.getElementById("cmd_customizeFromAddress");
  customizeMenuitem.setAttribute("disabled", "true");
  customizeMenuitem.setAttribute("checked", "true");
  var identityElement = document.getElementById("msgIdentity");
  identityElement.removeAttribute("type");
  identityElement.editable = true;
  identityElement.focus();
  identityElement.value = identityElement.selectedItem.value;
  identityElement.select();
  identityElement.inputField.placeholder = getComposeBundle().getFormattedString("msgIdentityPlaceholder", [identityElement.selectedItem.value]);
}

function setupAutocomplete()
{
  var autoCompleteWidget = document.getElementById("addressCol2#1");

  // if the pref is set to turn on the comment column, honor it here.
  // this element then gets cloned for subsequent rows, so they should
  // honor it as well
  //
  try
  {
    if (getPref("mail.autoComplete.highlightNonMatches"))
      autoCompleteWidget.highlightNonMatches = true;

    if (getPref("mail.autoComplete.commentColumn"))
      autoCompleteWidget.showCommentColumn = true;
  } catch (ex)
  {
      // if we can't get this pref, then don't show the columns (which is
      // what the XUL defaults to)
  }
}

function fromKeyPress(event)
{
  if (event.keyCode == KeyEvent.DOM_VK_RETURN)
    awSetFocus(1, awGetInputElement(1));
}

function subjectKeyPress(event)
{
  gSubjectChanged = true;
  if (event.keyCode == KeyEvent.DOM_VK_RETURN)
    SetMsgBodyFrameFocus();
}

function AttachmentBucketClicked(event)
{
  let boundTarget = document.getBindingParent(event.originalTarget);
  if (event.button == 0 && boundTarget && boundTarget.localName == "scrollbox")
    goDoCommand('cmd_attachFile');
}

// we can drag and drop addresses, files, messages and urls into the compose envelope
var envelopeDragObserver = {

  canHandleMultipleItems: true,

  onDrop: function (aEvent, aData, aDragSession)
    {
      var dataList = aData.dataList;
      var dataListLength = dataList.length;
      var errorTitle;
      var attachment;
      var errorMsg;
      var attachments = [];

      for (let i = 0; i < dataListLength; i++)
      {
        var item = dataList[i].first;
        var prettyName;
        var size;
        var rawData = item.data;

        // We could be dropping an attachment OR an address, check and do the right thing..

        if (item.flavour.contentType == "text/x-moz-url" ||
            item.flavour.contentType == "text/x-moz-message" ||
            item.flavour.contentType == "application/x-moz-file")
        {
          if (item.flavour.contentType == "application/x-moz-file")
          {
            let fileHandler = Services.io
                                      .getProtocolHandler("file")
                                      .QueryInterface(Components.interfaces.nsIFileProtocolHandler);

            size = rawData.fileSize;
            rawData = fileHandler.getURLSpecFromFile(rawData);
          }
          else if (item.flavour.contentType == "text/x-moz-message")
          {
            size = gMessenger.messageServiceFromURI(rawData)
                             .messageURIToMsgHdr(rawData).messageSize;
          }
          else
          {
            var pieces = rawData.split("\n");
            rawData = pieces[0];
            if (pieces.length > 1)
              prettyName = pieces[1];
            if (pieces.length > 2)
              size = parseInt(pieces[2]);
          }

          var isValid = true;
          if (item.flavour.contentType == "text/x-moz-url") {
            // if this is a url (or selected text)
            // see if it's a valid url by checking
            // if we can extract a scheme
            // using Services.io
            //
            // also skip mailto:, since it doesn't make sense
            // to attach and send mailto urls
            try {
              let scheme = Services.io.extractScheme(rawData);
              // don't attach mailto: urls
              if (scheme == "mailto")
                isValid = false;
            }
            catch (ex) {
              isValid = false;
            }
          }

          if (isValid) {
            let attachment = Components.classes["@mozilla.org/messengercompose/attachment;1"]
                                       .createInstance(Components.interfaces.nsIMsgAttachment);
            attachment.url = rawData;
            attachment.name = prettyName;

            if (size !== undefined)
              attachment.size = size;

            attachments.push(attachment);
          }
        }
        else if (item.flavour.contentType == "text/x-moz-address")
        {
          // process the address
          if (rawData) {
            DropRecipient(aEvent.target, rawData);

            // Since we are now using ondrop (eDrop) instead of previously using
            // ondragdrop (eLegacyDragDrop), we must prevent the default
            // which is dropping the address text into the widget.
            // Note that stopPropagation() is called by our caller in
            // nsDragAndDrop.js.
            aEvent.preventDefault();
          }
        }
      }

      if (attachments.length)
        AddAttachments(attachments);
    },

  onDragOver: function (aEvent, aFlavour, aDragSession)
    {
      if (aFlavour.contentType != "text/x-moz-address")
      {
        // make sure the attachment box is visible during drag over
        var attachmentBox = document.getElementById("attachments-box");
        UpdateAttachmentBucket(true);
      }
      else
      {
          DragAddressOverTargetControl(aEvent);
      }
    },

  onDragExit: function (aEvent, aDragSession)
    {
    },

  getSupportedFlavours: function ()
    {
      var flavourSet = new FlavourSet();
      flavourSet.appendFlavour("text/x-moz-message");
      flavourSet.appendFlavour("application/x-moz-file", "nsIFile");
      flavourSet.appendFlavour("text/x-moz-address");
      flavourSet.appendFlavour("text/x-moz-url");
      return flavourSet;
    }
};

var attachmentBucketDNDObserver = {
  onDragStart: function (aEvent, aAttachmentData, aDragAction)
  {
    var target = aEvent.target;

    if (target.localName == "attachmentitem")
      aAttachmentData.data = CreateAttachmentTransferData(target.attachment);
  }
};

function DisplaySaveFolderDlg(folderURI)
{
  try
  {
    var showDialog = gCurrentIdentity.showSaveMsgDlg;
  }
  catch (e)
  {
    return;
  }

  if (showDialog){
    let msgfolder = MailUtils.getFolderForURI(folderURI, true);
    if (!msgfolder)
      return;
    let checkbox = {value:0};
    let SaveDlgTitle = getComposeBundle().getString("SaveDialogTitle");
    let dlgMsg = bundle.getFormattedString("SaveDialogMsg",
                                           [msgfolder.name,
                                            msgfolder.server.prettyName]);

    let CheckMsg = bundle.getString("CheckMsg");
    Services.prompt
            .alertCheck(window, SaveDlgTitle, dlgMsg,
                        getComposeBundle().getString("CheckMsg"), checkbox);
    try {
          gCurrentIdentity.showSaveMsgDlg = !checkbox.value;
    }//try
    catch (e) {
    return;
    }//catch

  }//if
  return;
}

function SetMsgAddressingWidgetTreeElementFocus()
{
  var element = awGetInputElement(awGetNumberOfRecipients());
  awSetFocus(awGetNumberOfRecipients(), element);
}

function SetMsgIdentityElementFocus()
{
  GetMsgIdentityElement().focus();
}

function SetMsgSubjectElementFocus()
{
  GetMsgSubjectElement().focus();
}

function SetMsgAttachmentElementFocus()
{
  GetMsgAttachmentElement().focus();
}

function SetMsgBodyFrameFocus()
{
  // window.content.focus() fails to blur the currently focused element
  document.commandDispatcher
          .advanceFocusIntoSubtree(document.getElementById("appcontent"));
}

function GetMsgAddressingWidgetTreeElement()
{
  if (!gMsgAddressingWidgetTreeElement)
    gMsgAddressingWidgetTreeElement = document.getElementById("addressingWidget");

  return gMsgAddressingWidgetTreeElement;
}

function GetMsgIdentityElement()
{
  if (!gMsgIdentityElement)
    gMsgIdentityElement = document.getElementById("msgIdentity");

  return gMsgIdentityElement;
}

function GetMsgSubjectElement()
{
  if (!gMsgSubjectElement)
    gMsgSubjectElement = document.getElementById("msgSubject");

  return gMsgSubjectElement;
}

function GetMsgAttachmentElement()
{
  if (!gMsgAttachmentElement)
    gMsgAttachmentElement = document.getElementById("attachmentBucket");

  return gMsgAttachmentElement;
}

function GetMsgHeadersToolbarElement()
{
  if (!gMsgHeadersToolbarElement)
    gMsgHeadersToolbarElement = document.getElementById("MsgHeadersToolbar");

  return gMsgHeadersToolbarElement;
}

function WhichElementHasFocus()
{
  var msgIdentityElement             = GetMsgIdentityElement();
  var msgAddressingWidgetTreeElement = GetMsgAddressingWidgetTreeElement();
  var msgSubjectElement              = GetMsgSubjectElement();
  var msgAttachmentElement           = GetMsgAttachmentElement();

  if (top.document.commandDispatcher.focusedWindow == content)
    return content;

  var currentNode = top.document.commandDispatcher.focusedElement;
  while (currentNode)
  {
    if (currentNode == msgIdentityElement ||
        currentNode == msgAddressingWidgetTreeElement ||
        currentNode == msgSubjectElement ||
        currentNode == msgAttachmentElement)
      return currentNode;

    currentNode = currentNode.parentNode;
  }

  return null;
}

// Function that performs the logic of switching focus from
// one element to another in the mail compose window.
// The default element to switch to when going in either
// direction (shift or no shift key pressed), is the
// AddressingWidgetTreeElement.
//
// The only exception is when the MsgHeadersToolbar is
// collapsed, then the focus will always be on the body of
// the message.
function SwitchElementFocus(event)
{
  var focusedElement = WhichElementHasFocus();

  if (event && event.shiftKey)
  {
    if (focusedElement == gMsgAddressingWidgetTreeElement)
      SetMsgIdentityElementFocus();
    else if (focusedElement == gMsgIdentityElement)
      SetMsgBodyFrameFocus();
    else if (focusedElement == content)
    {
      // only set focus to the attachment element if there
      // are any attachments.
      if (AttachmentElementHasItems())
        SetMsgAttachmentElementFocus();
      else
        SetMsgSubjectElementFocus();
    }
    else if (focusedElement == gMsgAttachmentElement)
      SetMsgSubjectElementFocus();
    else
      SetMsgAddressingWidgetTreeElementFocus();
  }
  else
  {
    if (focusedElement == gMsgAddressingWidgetTreeElement)
      SetMsgSubjectElementFocus();
    else if (focusedElement == gMsgSubjectElement)
    {
      // only set focus to the attachment element if there
      // are any attachments.
      if (AttachmentElementHasItems())
        SetMsgAttachmentElementFocus();
      else
        SetMsgBodyFrameFocus();
    }
    else if (focusedElement == gMsgAttachmentElement)
      SetMsgBodyFrameFocus();
    else if (focusedElement == content)
      SetMsgIdentityElementFocus();
    else
      SetMsgAddressingWidgetTreeElementFocus();
  }
}

function toggleAddressPicker()
{
  var sidebarBox = document.getElementById("sidebar-box");
  var sidebarSplitter = document.getElementById("sidebar-splitter");
  var elt = document.getElementById("viewAddressPicker");
  if (sidebarBox.hidden)
  {
    sidebarBox.hidden = false;
    sidebarSplitter.hidden = false;
    elt.setAttribute("checked","true");

    var sidebar = document.getElementById("sidebar");
    var sidebarUrl = sidebar.getAttribute("src");
    // if we have yet to initialize the src url on the sidebar than go ahead and do so now...
    // we do this lazily here, so we don't spend time when bringing up the compose window loading the address book
    // data sources. Only when the user opens the address picker do we set the src url for the sidebar...
    if (sidebarUrl == "")
      sidebar.setAttribute("src", "chrome://messenger/content/addressbook/abContactsPanel.xul");

    sidebarBox.setAttribute("sidebarVisible", "true");
  }
  else
  {
    sidebarBox.hidden = true;
    sidebarSplitter.hidden = true;
    sidebarBox.setAttribute("sidebarVisible", "false");
    elt.removeAttribute("checked");
  }
}

// public method called by the address picker sidebar
function AddRecipient(recipientType, address)
{
  awAddRecipient(recipientType, address);
}

function loadHTMLMsgPrefs()
{
  var fontFace;
  var fontSize;
  var textColor;
  var bgColor;

  try {
    fontFace = getPref("msgcompose.font_face", true);
    doStatefulCommand('cmd_fontFace', fontFace);
  } catch (e) {}

  try {
    fontSize = getPref("msgcompose.font_size");
    EditorSetFontSize(fontSize);
  } catch (e) {}

  var bodyElement = GetBodyElement();

  try {
    textColor = getPref("msgcompose.text_color");
    if (!bodyElement.getAttribute("text"))
    {
    bodyElement.setAttribute("text", textColor);
    gDefaultTextColor = textColor;
    document.getElementById("cmd_fontColor").setAttribute("state", textColor);
    onFontColorChange();
    }
  } catch (e) {}

  try {
    bgColor = getPref("msgcompose.background_color");
    if (!bodyElement.getAttribute("bgcolor"))
    {
    bodyElement.setAttribute("bgcolor", bgColor);
    gDefaultBackgroundColor = bgColor;
    document.getElementById("cmd_backgroundColor").setAttribute("state", bgColor);
    onBackgroundColorChange();
    }
  } catch (e) {}
}

function AutoSave()
{
  if (gMsgCompose.editor && (gContentChanged || gMsgCompose.bodyModified) &&
      !gSendOperationInProgress && !gSaveOperationInProgress)
  {
    GenericSendMessage(nsIMsgCompDeliverMode.AutoSaveAsDraft);
    gAutoSaveKickedIn = true;
  }

  gAutoSaveTimeout = setTimeout(AutoSave, gAutoSaveInterval);
}

/**
 * Periodically check for keywords in the message.
 */
var gAttachmentNotifier =
{
  _obs: null,

  enabled: false,

  init: function gAN_init(aDocument) {
    if (this._obs)
      this.shutdown();

    this.enabled = getPref("mail.compose.attachment_reminder");
    if (!this.enabled)
      return;

    this._obs = new MutationObserver(function gAN_handleMutations(aMutations) {
      gAttachmentNotifier.timer.cancel();
      gAttachmentNotifier.timer.initWithCallback(gAttachmentNotifier.event, 500,
                                                 Components.interfaces.nsITimer.TYPE_ONE_SHOT);
    });

    this._obs.observe(aDocument, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });

    // Add an input event listener for the subject field since there
    // are ways of changing its value without key presses.
    GetMsgSubjectElement().addEventListener("input",
      this.subjectObserver, true);
  },

  // Timer based function triggered by the inputEventListener
  // for the subject field.
  subjectObserver: function handleEvent() {
    gAttachmentNotifier.timer.cancel();
    gAttachmentNotifier.timer.initWithCallback(gAttachmentNotifier.event, 500,
                                               Components.interfaces.nsITimer.TYPE_ONE_SHOT);
  },

  /**
   * Checks for new keywords synchronously and run the usual handler.
   *
   * @param aManage  Determines whether to manage the notification according to keywords found.
   */
  redetectKeywords: function(aManage) {
    if (!this.enabled)
      return;

    attachmentWorker.onmessage({ data: this._checkForAttachmentKeywords(false) }, aManage);
  },

  /**
   * Check if there are any keywords in the message.
   *
   * @param async  Whether we should run the regex checker asynchronously or not.
   *
   * @return  If async is true, attachmentWorker.message is called with the array
   *          of found keywords and this function returns null.
   *          If it is false, the array is returned from this function immediately.
   */
  _checkForAttachmentKeywords: function(async)
  {
    if (!this.enabled)
      return (async ? null : []);

    if (attachmentNotificationSupressed()) {
      // If we know we don't need to show the notification,
      // we can skip the expensive checking of keywords in the message.
      // but mark it in the .lastMessage that the keywords are unknown.
      attachmentWorker.lastMessage = null;
      return (async ? null : []);
    }

    let keywordsInCsv = Services.prefs.getComplexValue(
      "mail.compose.attachment_reminder_keywords",
      Components.interfaces.nsIPrefLocalizedString).data;
    let mailBody = document.getElementById("content-frame")
                           .contentDocument.querySelector("body");
    let mailBodyNode = mailBody.cloneNode(true);

    // Don't check quoted text from reply.
    let blockquotes = mailBodyNode.getElementsByTagName("blockquote");
    for (let i = blockquotes.length - 1; i >= 0; i--) {
      blockquotes[i].remove();
    }

    // For plaintext composition the quotes we need to find and exclude are
    // <span _moz_quote="true">.
    let spans = mailBodyNode.querySelectorAll("span[_moz_quote]");
    for (let i = spans.length - 1; i >= 0; i--) {
      spans[i].remove();
    }

    // Ignore signature (html compose mode).
    let sigs = mailBodyNode.getElementsByClassName("moz-signature");
    for (let i = sigs.length - 1; i >= 0; i--) {
      sigs[i].remove();
    }

    // Replace brs with line breaks so node.textContent won't pull foo<br>bar
    // together to foobar.
    let brs = mailBodyNode.getElementsByTagName("br");
    for (let i = brs.length - 1; i >= 0; i--) {
      brs[i].parentNode.replaceChild(mailBodyNode.ownerDocument.createTextNode("\n"), brs[i]);
    }

    // Ignore signature (plain text compose mode).
    let mailData = mailBodyNode.textContent;
    let sigIndex = mailData.indexOf("-- \n");
    if (sigIndex > 0)
      mailData = mailData.substring(0, sigIndex);

    // Ignore replied messages (plain text and html compose mode).
    let repText = getComposeBundle().getString("mailnews.reply_header_originalmessage");
    let repIndex = mailData.indexOf(repText);
    if (repIndex > 0)
      mailData = mailData.substring(0, repIndex);

    // Ignore forwarded messages (plain text and html compose mode).
    let fwdText = getComposeBundle().getString("mailnews.forward_header_originalmessage");
    let fwdIndex = mailData.indexOf(fwdText);
    if (fwdIndex > 0)
      mailData = mailData.substring(0, fwdIndex);

    // Prepend the subject to see if the subject contains any attachment
    // keywords too, after making sure that the subject has changed.
    let subject = GetMsgSubjectElement().value;
    if (subject && (gSubjectChanged ||
       (gEditingDraft &&
         (gComposeType == nsIMsgCompType.New ||
         gComposeType == nsIMsgCompType.NewsPost ||
         gComposeType == nsIMsgCompType.Draft ||
         gComposeType == nsIMsgCompType.Template ||
         gComposeType == nsIMsgCompType.MailToUrl))))
      mailData = subject + " " + mailData;

    if (!async)
      return GetAttachmentKeywords(mailData, keywordsInCsv);

    attachmentWorker.postMessage([mailData, keywordsInCsv]);
    return null;
  },

  shutdown: function gAN_shutdown() {
    if (this._obs)
      this._obs.disconnect();
    gAttachmentNotifier.timer.cancel();

    this._obs = null;
  },

  event: {
    notify: function(timer)
    {
      // Only run the checker if the compose window is initialized
      // and not shutting down.
      if (gMsgCompose) {
        // This runs the attachmentWorker asynchronously so if keywords are found
        // manageAttachmentNotification is run from attachmentWorker.onmessage.
        gAttachmentNotifier._checkForAttachmentKeywords(true);
      }
    }
  },

  timer: Components.classes["@mozilla.org/timer;1"]
                   .createInstance(Components.interfaces.nsITimer)
};

function InitEditor()
{
  var editor = GetCurrentEditor();

  // Set eEditorMailMask flag to avoid using content prefs for spell checker,
  // otherwise dictionary setting in preferences is ignored and dictionary is
  // inconsistent in subject and message body.
  let eEditorMailMask = Components.interfaces.nsIPlaintextEditor.eEditorMailMask;
  editor.flags |= eEditorMailMask;
  GetMsgSubjectElement().editor.flags |= eEditorMailMask;

  // Control insertion of line breaks.
  editor.returnInParagraphCreatesNewParagraph =
    Services.prefs.getBoolPref("editor.CR_creates_new_p");

  editor.QueryInterface(nsIEditorStyleSheets);
  // We use addOverrideStyleSheet rather than addStyleSheet so that we get
  // a synchronous load, rather than having a late-finishing async load
  // mark our editor as modified when the user hasn't typed anything yet,
  // but that means the sheet must not @import slow things, especially
  // not over the network.
  editor.addOverrideStyleSheet("chrome://messenger/content/composerOverlay.css");
  gMsgCompose.initEditor(editor, window.content);

  // We always go through this function everytime we init an editor, be it a
  // recycled editor, or a fresh one. First step is making sure we can spell
  // check.
  gSpellChecker.init(editor);
  document.getElementById('menu_inlineSpellCheck')
          .setAttribute('disabled', !gSpellChecker.canSpellCheck);
  document.getElementById('spellCheckEnable')
          .setAttribute('disabled', !gSpellChecker.canSpellCheck);
  // If canSpellCheck = false, then hidden = false, i.e. show it so that we can
  // still add dictionaries. Else, hide that.
  document.getElementById('spellCheckAddDictionariesMain')
          .setAttribute('hidden', gSpellChecker.canSpellCheck);
  // Then, we enable related UI entries.
  enableInlineSpellCheck(getPref("mail.spellcheck.inline"));
  gAttachmentNotifier.init(editor.document);

  // Listen for spellchecker changes, set document language to
  // dictionary picked by the user via the right-click menu in the editor.
  document.addEventListener("spellcheck-changed", updateDocumentLanguage);
}

// This is used as event listener to spellcheck-changed event to update
// document language.
function updateDocumentLanguage(e)
{
  document.documentElement.setAttribute("lang", e.detail.dictionary);
}

// This function modifies gSpellChecker and updates the UI accordingly. It's
// called either at startup (see InitEditor above), or when the user clicks on
// one of the two menu items that allow them to toggle the spellcheck feature
// (either context menu or Options menu).
function enableInlineSpellCheck(aEnableInlineSpellCheck)
{
  gSpellChecker.enabled = aEnableInlineSpellCheck;
  document.getElementById('msgSubject').setAttribute('spellcheck', aEnableInlineSpellCheck);
  document.getElementById("menu_inlineSpellCheck")
          .setAttribute('checked', aEnableInlineSpellCheck);
  document.getElementById("spellCheckEnable")
          .setAttribute('checked', aEnableInlineSpellCheck);
  document.getElementById('spellCheckDictionaries')
          .setAttribute('hidden', !aEnableInlineSpellCheck);
}

function getMailToolbox()
{
  return document.getElementById("compose-toolbox");
}

function getPref(aPrefName, aIsComplex) {
  const Ci = Components.interfaces;
  if (aIsComplex) {
    return Services.prefs
                   .getComplexValue(aPrefName, Ci.nsISupportsString).data;
  }
  switch (Services.prefs.getPrefType(aPrefName)) {
    case Ci.nsIPrefBranch.PREF_BOOL:
      return Services.prefs.getBoolPref(aPrefName);
    case Ci.nsIPrefBranch.PREF_INT:
      return Services.prefs.getIntPref(aPrefName);
    case Ci.nsIPrefBranch.PREF_STRING:
      return Services.prefs.getCharPref(aPrefName);
    default: // includes nsIPrefBranch.PREF_INVALID
      return null;
  }
}

/**
 * Helper function to dispatch a CustomEvent to the attachmentbucket.
 *
 * @param aEventType the name of the event to fire.
 * @param aData any detail data to pass to the CustomEvent.
 */
function dispatchAttachmentBucketEvent(aEventType, aData) {
  let bucket = document.getElementById("attachmentBucket");
  let event = document.createEvent("CustomEvent");
  event.initCustomEvent(aEventType, true, true, aData);
  bucket.dispatchEvent(event);
}

/** Update state of zoom type (text vs. full) menu item. */
function UpdateFullZoomMenu() {
  let menuItem = document.getElementById("menu_fullZoomToggle");
  menuItem.setAttribute("checked", !ZoomManager.useFullZoom);
}

// The zoom manager, view source and possibly some other functions still rely
// on the getBrowser function.
function getBrowser()
{
  // return our <editor> element
  return document.getElementById("content-frame");
}

function goUpdateMailMenuItems(commandset)
{
  for (let i = 0; i < commandset.childNodes.length; i++)
  {
    let commandID = commandset.childNodes[i].getAttribute("id");
    if (commandID)
      goUpdateCommand(commandID);
  }
}
