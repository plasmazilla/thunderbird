/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * vim: sw=2 ts=2 et lcs=trail\:.,tab\:>~ :
 * ***** BEGIN LICENSE BLOCK *****
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
 * The Original Code is Oracle Corporation code.
 *
 * The Initial Developer of the Original Code is
 *  Oracle Corporation
 * Portions created by the Initial Developer are Copyright (C) 2004
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Vladimir Vukicevic <vladimir.vukicevic@oracle.com>
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

#ifndef _mozStorageStatement_h_
#define _mozStorageStatement_h_

#include "nsAutoPtr.h"
#include "nsString.h"

#include "nsTArray.h"

#include "mozStorageBindingParamsArray.h"
#include "mozIStorageStatement.h"

class nsIXPConnectJSObjectHolder;
struct sqlite3_stmt;

namespace mozilla {
namespace storage {
class StatementJSHelper;
class Connection;
class BindingParams;
class StatementData;

class Statement : public mozIStorageStatement
{
public:
  NS_DECL_ISUPPORTS
  NS_DECL_MOZISTORAGESTATEMENT
  NS_DECL_MOZISTORAGEVALUEARRAY

  Statement();

  /**
   * Initializes the object on aDBConnection by preparing the SQL statement
   * given by aSQLStatement.
   *
   * @param aDBConnection
   *        The Connection object this statement is associated with.
   * @param aSQLStatement
   *        The SQL statement to prepare that this object will represent.
   */
  nsresult initialize(Connection *aDBConnection,
                      const nsACString &aSQLStatement);


  /**
   * Obtains the native synchronous statement pointer.
   */
  inline sqlite3_stmt *nativeStatement()
  {
    (void)ensureSyncStatement();
    return mDBStatement;
  }

  /**
   * Obtains the connection that owns this statement.
   */
  inline Connection *owningConnection() { return mDBConnection; }

  /**
   * Indicate whether the synchronous statement has already been created.  This
   * allows code to avoid triggering statement creation if it has a fallback
   * capability.  (Triggering statement creation requires acquiring the SQLite
   * mutex which can cause us to block on the async thread which can be highly
   * undesirable.)
   */
  inline bool syncStatementAvailable() { return mDBStatement != 0; }

  /**
   * Obtains and transfers ownership of the array of parameters that are bound
   * to this statment.  This can be null.
   */
  inline already_AddRefed<BindingParamsArray> bindingParamsArray()
  {
    return mParamsArray.forget();
  }

  /**
   * Obtains the StatementData needed for asynchronous execution.
   *
   * @param _data
   *        A reference to a StatementData object that will be populated upon
   *        successful execution of this method.
   * @return an nsresult indicating success or failure.
   */
  nsresult getAsynchronousStatementData(StatementData &_data);

private:
    ~Statement();

    nsRefPtr<Connection> mDBConnection;
    nsCString mSQLString;

    /**
     * The synchronous SQL statement for this statement.  It is initialized on
     * demand by ensureSyncStatement.  We do not intialize it when this object
     * is created because that requires acquiring the sqlite mutex.
     */
    sqlite3_stmt *mDBStatement;

    /**
     * Ensures that the synchronous statement has been initialized.  Since this
     * can fail, be sure to use NS_ENSURE_SUCCESS on the returned value.
     *
     * A consequence of the on-demand creation is that if we are provided with
     * illegal SQL, every time we are invoked we will attempt to re-create
     * the sqlite3 statement and fail.
     */
    inline nsresult ensureSyncStatement()
    {
      if (mDBStatement != NULL)
        return NS_OK;
      return buildSyncStatement();
    }

    /**
     * Actually build the synchronous DB statement; used by ensureSyncStatement
     * which is intended to be inlined.  (Inlining this logic would be a bit
     * much.)
     */
    nsresult buildSyncStatement();

    PRUint32 mParamCount;
    PRUint32 mResultColumnCount;
    nsTArray<nsCString> mColumnNames;
    bool mExecuting;

    /**
     * @return a pointer to the BindingParams object to use with our Bind*
     *         method.
     */
    BindingParams *getParams();

    /**
     * Holds the array of parameters to bind to this statement when we execute
     * it asynchronously.
     */
    nsRefPtr<BindingParamsArray> mParamsArray;

    /**
     * Holds a copy of mDBStatement that we can use asynchronously.  Access to
     * this is serialized on the asynchronous thread, so it does not need to be
     * protected.  We will finalize this statement in our destructor.
     */
    sqlite3_stmt *mCachedAsyncStatement;
    /**
     * Have we done anything which could cause mCachedAsyncStatement to have a
     * live statement?  Because it is populated only when the async statement
     * is executed, it is possible for mCachedAsyncStatement to be null when
     * we want to check at finalization.  Additionally, it is only 'potentially'
     * because it could get canceled before execution or fail to create due to
     * illegal SQL.
     */
    bool mPotentiallyLiveAsyncStatement;

    /**
     * Obtains the statement to use on the background thread.
     *
     * @param _stmt
     *        An outparm where the new statement should be placed.
     * @return a SQLite result code indicating success or failure.
     */
    int getAsyncStatement(sqlite3_stmt **_stmt);

    /**
     * For use by AsyncStatementFinalizer to complete finalization of the
     * asynchronous statement.
     */
    void cleanupAsyncStatement();

    /**
     * The following two members are only used with the JS helper.  They cache
     * the row and params objects.
     */
    nsCOMPtr<nsIXPConnectJSObjectHolder> mStatementParamsHolder;
    nsCOMPtr<nsIXPConnectJSObjectHolder> mStatementRowHolder;

    /**
     * Has finalize been called?  We cannot simply rely on the state of
     * mSQLString being void or not because we may need to keep it alive for the
     * benefit of the async statement.
     */
    bool mFinalized;

    /**
     * Flag set by the destructor so Finalize can know if it is being invoked
     * by the destructor.
     */
    bool mDestructing;

    friend class StatementJSHelper;
    // StatementData needs access to getAsyncStatement.
    friend class StatementData;
    // AsyncStatementFinalizer needs access to cleanupAsyncStatement.
    friend class AsyncStatementFinalizer;
};

} // storage
} // mozilla

#endif // _mozStorageStatement_h_
