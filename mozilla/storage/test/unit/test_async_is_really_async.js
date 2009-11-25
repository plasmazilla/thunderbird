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
 * The Original Code is Storage Test Code.
 *
 * The Initial Developer of the Original Code is
 *   Mozilla Corporation.
 * Portions created by the Initial Developer are Copyright (C) 2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Shawn Wilsher <me@shawnwilsher.com> (Original Author)
 *   Andrew Sutherland <asutherland@asutherland.org>
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
//// Test Runner

const INTEGER = 1;
const TEXT = "this is test text";
const REAL = 3.23;
const BLOB = [1, 2];

function test_create_table()
{
  var stmt = getOpenedDatabase().createStatement(
    "CREATE TABLE test (" +
      "id INTEGER, " +
      "string TEXT, " +
      "number REAL, " +
      "nuller NULL, " +
      "blober BLOB" +
    ")"
  );

  stmt.executeAsync({
    handleResult: function(aResultSet)
    {
      dump("handleResult("+aResultSet+");\n");
      do_throw("unexpected results obtained!");
    },
    handleError: function(aError)
    {
      print("error code " + aError.result + " with message '" +
            aError.message + "' returned.");
      do_throw("unexpected error!");
    },
    handleCompletion: function(aReason)
    {
      print("handleCompletion(" + aReason + ") for test_create_table");
      do_check_eq(Ci.mozIStorageStatementCallback.REASON_FINISHED, aReason);

      // Run the next test.
      run_next_test();
    }
  });
  stmt.finalize();
}

function test_add_data()
{
  var stmt = getOpenedDatabase().createStatement(
    "INSERT INTO test (id, string, number, nuller, blober) " +
    "VALUES (?, ?, ?, ?, ?)"
  );
  stmt.bindBlobParameter(4, BLOB, BLOB.length);
  stmt.bindNullParameter(3);
  stmt.bindDoubleParameter(2, REAL);
  stmt.bindStringParameter(1, TEXT);
  stmt.bindInt32Parameter(0, INTEGER);

  stmt.executeAsync({
    handleResult: function(aResultSet)
    {
      do_throw("unexpected results obtained!");
    },
    handleError: function(aError)
    {
      print("error code " + aError.result + " with message '" +
            aError.message + "' returned.");
      do_throw("unexpected error!");
    },
    handleCompletion: function(aReason)
    {
      print("handleCompletion(" + aReason + ") for test_add_data");
      do_check_eq(Ci.mozIStorageStatementCallback.REASON_FINISHED, aReason);

      // Run the next test.
      run_next_test();
    }
  });
  stmt.finalize();
}

function test_get_data()
{
  var stmt = getOpenedDatabase().createStatement(
    "SELECT string, number, nuller, blober, id FROM test WHERE id = ?"
  );
  stmt.bindInt32Parameter(0, INTEGER);

  stmt.executeAsync({
    resultObtained: false,
    handleResult: function(aResultSet)
    {
      dump("handleResult("+aResultSet+");\n");
      do_check_false(this.resultObtained);
      this.resultObtained = true;

      // Check that we have a result
      var tuple = aResultSet.getNextRow();
      do_check_neq(null, tuple);

      // Check that it's what we expect
      do_check_false(tuple.getIsNull(0));
      do_check_eq(tuple.getResultByName("string"), tuple.getResultByIndex(0));
      do_check_eq(TEXT, tuple.getResultByName("string"));
      do_check_eq(Ci.mozIStorageValueArray.VALUE_TYPE_TEXT,
                  tuple.getTypeOfIndex(0));

      do_check_false(tuple.getIsNull(1));
      do_check_eq(tuple.getResultByName("number"), tuple.getResultByIndex(1));
      do_check_eq(REAL, tuple.getResultByName("number"));
      do_check_eq(Ci.mozIStorageValueArray.VALUE_TYPE_FLOAT,
                  tuple.getTypeOfIndex(1));

      do_check_true(tuple.getIsNull(2));
      do_check_eq(tuple.getResultByName("nuller"), tuple.getResultByIndex(2));
      do_check_eq(null, tuple.getResultByName("nuller"));
      do_check_eq(Ci.mozIStorageValueArray.VALUE_TYPE_NULL,
                  tuple.getTypeOfIndex(2));

      do_check_false(tuple.getIsNull(3));
      var blobByName = tuple.getResultByName("blober");
      do_check_eq(BLOB.length, blobByName.length);
      var blobByIndex = tuple.getResultByIndex(3);
      do_check_eq(BLOB.length, blobByIndex.length);
      for (var i = 0; i < BLOB.length; i++) {
        do_check_eq(BLOB[i], blobByName[i]);
        do_check_eq(BLOB[i], blobByIndex[i]);
      }
      var count = { value: 0 };
      var blob = { value: null };
      tuple.getBlob(3, count, blob);
      do_check_eq(BLOB.length, count.value);
      for (var i = 0; i < BLOB.length; i++)
        do_check_eq(BLOB[i], blob.value[i]);
      do_check_eq(Ci.mozIStorageValueArray.VALUE_TYPE_BLOB,
                  tuple.getTypeOfIndex(3));

      do_check_false(tuple.getIsNull(4));
      do_check_eq(tuple.getResultByName("id"), tuple.getResultByIndex(4));
      do_check_eq(INTEGER, tuple.getResultByName("id"));
      do_check_eq(Ci.mozIStorageValueArray.VALUE_TYPE_INTEGER,
                  tuple.getTypeOfIndex(4));

      // check that we have no more results
      tuple = aResultSet.getNextRow();
      do_check_eq(null, tuple);
    },
    handleError: function(aError)
    {
      print("error code " + aerror.result + " with message '" +
            aerror.message + "' returned.");
      do_throw("unexpected error!");
    },
    handleCompletion: function(aReason)
    {
      print("handleCompletion(" + aReason + ") for test_get_data");
      do_check_eq(Ci.mozIStorageStatementCallback.REASON_FINISHED, aReason);
      do_check_true(this.resultObtained);

      // Run the next test.
      run_next_test();
    }
  });
  stmt.finalize();
}

function test_bind_multiple_rows_by_index()
{
  const AMOUNT_TO_ADD = 5;
  var stmt = getOpenedDatabase().createStatement(
    "INSERT INTO test (id, string, number, nuller, blober) " +
    "VALUES (?, ?, ?, ?, ?)"
  );
  var array = stmt.newBindingParamsArray();
  for (let i = 0; i < AMOUNT_TO_ADD; i++) {
    let bp = array.newBindingParams();
    bp.bindByIndex(0, INTEGER);
    bp.bindByIndex(1, TEXT);
    bp.bindByIndex(2, REAL);
    bp.bindByIndex(3, null);
    bp.bindBlobByIndex(4, BLOB, BLOB.length);
    array.addParams(bp);
  }
  stmt.bindParameters(array);

  // Execute asynchronously.
  stmt.executeAsync({
    handleResult: function(aResultSet)
    {
      do_throw("Unexpected call to handleResult!");
    },
    handleError: function(aError)
    {
      print("Error code " + aError.result + " with message '" +
            aError.message + "' returned.");
      do_throw("unexpected error!");
    },
    handleCompletion: function(aReason)
    {
      print("handleCompletion(" + aReason +
            ") for test_bind_multiple_rows_by_index");
      do_check_eq(Ci.mozIStorageStatementCallback.REASON_FINISHED, aReason);

      // Run the next test.
      run_next_test();
    }
  });
  stmt.finalize();
}

function test_multiple_results()
{
  // Now check that we get back two rows of data from our async query.
  let stmt = createStatement("SELECT * FROM test");
  stmt.executeAsync({
    _results: 0,
    handleResult: function(aResultSet)
    {
      while (aResultSet.getNextRow())
        this._results++;
    },
    handleError: function(aError)
    {
      print("Error code " + aError.result + " with message '" +
            aError.message + "' returned.");
      do_throw("Unexpected call to handleError!");
    },
    handleCompletion: function(aReason)
    {
      print("handleCompletion(" + aReason +
            ") for test_multiple_results");
      do_check_eq(Ci.mozIStorageStatementCallback.REASON_FINISHED, aReason);

      // Make sure we have multiple results
      do_check_true(this._results > 1);

      // Run the next test.
      run_next_test();
    }
  });
  stmt.finalize();
}


function mark_begining_of_test()
{
  // open the database, this will cause mutex accesses from the main thread
  getOpenedDatabase();

  do_check_eq("fake test","fake test");

  // I realize I could use string continuations...
  dump("\
*** Exciting verification that async operation is really async.\n\
Before running this test you should have set a breakpoint on:\n\
 xpc_DebuggerKeywordHandler\n\
like so:\n\
  break xpc_DebuggerKeywordHandler\n\
\n\
We are about to trigger the debugger keyword which should hit your breakpoint.\n\
At that point you are going to want to add the following conditional break:\n\
  break sqlite3_mutex_enter thread 1\n\
and then make sure that we never break on that breakpoint until you hit the\n\
next 'debugger' breakpoint.\n");
  debugger;

  run_next_test();
}

function mark_end_of_test()
{
  dump("\
*** If you got here without seeing a sqlite3_mutex_enter breakpoint, you win!\n\
");
  debugger;
  run_next_test();
}

var tests =
[
  mark_begining_of_test,
  test_create_table,
  test_add_data,
  test_get_data,
  test_bind_multiple_rows_by_index,
  test_multiple_results,
  mark_end_of_test,
];
let index = 0;

function run_next_test()
{
  if (index < tests.length) {
    do_test_pending();
    print("Running the next test: " + tests[index].name);
    try {
      tests[index++]();
    }
    catch (ex) {
      do_throw(ex);
    }
  }

  do_test_finished();
}

function run_test()
{
  // head_storage already calls cleanup().

  do_test_pending();
  run_next_test();
}
