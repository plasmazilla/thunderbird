/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tests draft related functionality:
 * - that we don't allow opening multiple copies of a draft.
 */

// make SOLO_TEST=composition/test-drafts.js mozmill-one

var MODULE_NAME = "test-drafts";

var RELATIVE_ROOT = "../shared-modules";
var MODULE_REQUIRES = ["folder-display-helpers", "compose-helpers",
                       "window-helpers", "notificationbox-helpers"];

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource:///modules/mailServices.js");

var kBoxId = "msgNotificationBar";
var draftsFolder;

function setupModule(module) {
  for (let lib of MODULE_REQUIRES) {
    collector.getModule(lib).installInto(module);
  }

  if (!MailServices.accounts
                   .localFoldersServer
                   .rootFolder
                   .containsChildNamed("Drafts")) {
    create_folder("Drafts", [Ci.nsMsgFolderFlags.Drafts]);
  }
  draftsFolder = MailServices.accounts
                             .localFoldersServer
                             .rootFolder
                             .getChildNamed("Drafts");
}

/**
 * Tests that we only open one compose window for one instance of a draft.
 */
function test_open_draft_again() {
  make_new_sets_in_folder(draftsFolder, [{count: 1}]);
  be_in_folder(draftsFolder);
  let draftMsg = select_click_row(0);

  // Wait for the notification with the Edit button.
  wait_for_notification_to_show(mc, kBoxId, "draftMsgContent");

  plan_for_new_window("msgcompose");
  mc.click(mc.eid(kBoxId, {tagName: "button", label: "Edit"}));
  let cwc = wait_for_compose_window();

  let cwins = 0;
  let e = Services.wm.getEnumerator("msgcompose");
  while (e.hasMoreElements()) {
    e.getNext();
    cwins++;
  }

  // click edit in main win again
  mc.click(mc.eid(kBoxId, {tagName: "button", label: "Edit"}));

  mc.sleep(1000); // wait a sec to see if it caused a new window

  assert_true(Services.ww.activeWindow == cwc.window,
    "the original draft composition window should have got focus (again)");

  let cwins2 = 0;
  let e2 = Services.wm.getEnumerator("msgcompose");
  while (e2.hasMoreElements()) {
    e2.getNext();
    cwins2++;
  }

  assert_true(cwins2 > 0, "No compose window open!");
  assert_equals(cwins, cwins2, "The number of compose windows changed!");
 
  // Type something and save, then check that we only have one draft.
  cwc.type(cwc.eid("content-frame"), "Hello!");
  cwc.keypress(null, "s", {shiftKey: false, accelKey: true});
  close_compose_window(cwc);
  assert_equals(draftsFolder.getTotalMessages(false), 1);

  press_delete(mc); // clean up after ourselves
}

/**
 * Tests that 'Edit as New' leaves the original message in drafts folder.
 */
function test_edit_as_new_in_draft() {
  make_new_sets_in_folder(draftsFolder, [{count: 1}]);
  be_in_folder(draftsFolder);

  assert_equals(draftsFolder.getTotalMessages(false), 1);

  let draftMsg = select_click_row(0);

  // Wait for the notification with the Edit button.
  wait_for_notification_to_show(mc, kBoxId, "draftMsgContent");

  plan_for_new_window("msgcompose");
  mc.keypress(null, "e", {shiftKey: false, accelKey: true});
  let cwc = wait_for_compose_window();

  cwc.type(cwc.eid("content-frame"), "Hello!");
  cwc.keypress(null, "s", {shiftKey: false, accelKey: true});

  close_compose_window(cwc);
  assert_equals(draftsFolder.getTotalMessages(false), 2);

  // Clean up the created drafts and count again.
  press_delete(mc);
  press_delete(mc);
  assert_equals(draftsFolder.getTotalMessages(false), 0);
}

function teardownModule() {
  MailServices.accounts.localFoldersServer.rootFolder
              .propagateDelete(draftsFolder, true, null);
}
