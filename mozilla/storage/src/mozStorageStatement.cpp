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
 *   Shawn Wilsher <me@shawnwilsher.com>
 *   John Zhang <jzhang@aptana.com>
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

#include <stdio.h>

#include "nsError.h"
#include "nsMemory.h"
#include "nsThreadUtils.h"
#include "nsIClassInfoImpl.h"
#include "nsIProgrammingLanguage.h"

#include "mozIStorageError.h"

#include "mozStorageBindingParams.h"
#include "mozStorageConnection.h"
#include "mozStorageStatementJSHelper.h"
#include "mozStoragePrivateHelpers.h"
#include "mozStorageStatementParams.h"
#include "mozStorageStatementRow.h"
#include "mozStorageStatement.h"
#include "mozStorageStatementData.h"

#include "prlog.h"

#ifdef PR_LOGGING
extern PRLogModuleInfo* gStorageLog;
#endif

namespace mozilla {
namespace storage {

////////////////////////////////////////////////////////////////////////////////
//// Local Classes

/**
 * Used to finalize an asynchronous statement on the background thread.
 *
 * This class gets a reference-counted reference to the Statement whose async
 * statement needs to be cleaned up.  We are only created if the Statement was
 * not being destructed so there is no risk of getting a zombie reference.
 *
 * We used to be in the anonymous namespace but that precluded our being a
 * friend of Statement.
 */
class AsyncStatementFinalizer : public nsRunnable
{
public:
  AsyncStatementFinalizer(Statement *aStatement)
  : mStatement(aStatement)
  {
  }

  NS_IMETHOD Run()
  {
    (void)mStatement->cleanupAsyncStatement();
    return NS_OK;
  }
private:
  nsRefPtr<Statement> mStatement;
};

////////////////////////////////////////////////////////////////////////////////
//// nsIClassInfo

NS_IMPL_CI_INTERFACE_GETTER2(
  Statement,
  mozIStorageStatement,
  mozIStorageValueArray
)

class StatementClassInfo : public nsIClassInfo
{
public:
  NS_DECL_ISUPPORTS

  NS_IMETHODIMP
  GetInterfaces(PRUint32 *_count, nsIID ***_array)
  {
    return NS_CI_INTERFACE_GETTER_NAME(Statement)(_count, _array);
  }

  NS_IMETHODIMP
  GetHelperForLanguage(PRUint32 aLanguage, nsISupports **_helper)
  {
    if (aLanguage == nsIProgrammingLanguage::JAVASCRIPT) {
      static StatementJSHelper sJSHelper;
      *_helper = &sJSHelper;
      return NS_OK;
    }

    *_helper = nsnull;
    return NS_OK;
  }

  NS_IMETHODIMP
  GetContractID(char **_contractID)
  {
    *_contractID = nsnull;
    return NS_OK;
  }

  NS_IMETHODIMP
  GetClassDescription(char **_desc)
  {
    *_desc = nsnull;
    return NS_OK;
  }

  NS_IMETHODIMP
  GetClassID(nsCID **_id)
  {
    *_id = nsnull;
    return NS_OK;
  }

  NS_IMETHODIMP
  GetImplementationLanguage(PRUint32 *_language)
  {
    *_language = nsIProgrammingLanguage::CPLUSPLUS;
    return NS_OK;
  }

  NS_IMETHODIMP
  GetFlags(PRUint32 *_flags)
  {
    *_flags = nsnull;
    return NS_OK;
  }

  NS_IMETHODIMP
  GetClassIDNoAlloc(nsCID *_cid)
  {
    return NS_ERROR_NOT_AVAILABLE;
  }
};

NS_IMETHODIMP_(nsrefcnt) StatementClassInfo::AddRef() { return 2; }
NS_IMETHODIMP_(nsrefcnt) StatementClassInfo::Release() { return 1; }
NS_IMPL_QUERY_INTERFACE1(StatementClassInfo, nsIClassInfo)

static StatementClassInfo sStatementClassInfo;

////////////////////////////////////////////////////////////////////////////////
//// Statement

Statement::Statement()
: mDBConnection(nsnull)
, mDBStatement(NULL)
, mColumnNames()
, mExecuting(false)
, mCachedAsyncStatement(NULL)
, mPotentiallyLiveAsyncStatement(false)
, mFinalized(false)
, mDestructing(false)
{
}

nsresult
Statement::initialize(Connection *aDBConnection,
                      const nsACString &aSQLStatement)
{
  NS_ASSERTION(aDBConnection, "No database connection given!");
  NS_ASSERTION(!mSQLString.IsVoid(), "Statement already initialized!");

  sqlite3 *db = aDBConnection->GetNativeConnection();
  NS_ASSERTION(db, "We should never be called with a null sqlite3 database!");

  mDBConnection = aDBConnection;
  mSQLString = aSQLStatement;

  return NS_OK;
}

nsresult
Statement::buildSyncStatement()
{
  if (mFinalized)
    return NS_ERROR_UNEXPECTED;

  sqlite3 *db = mDBConnection->GetNativeConnection();
  if (!db)
    return NS_ERROR_NOT_INITIALIZED;

  int srv = ::sqlite3_prepare_v2(db, PromiseFlatCString(mSQLString).get(),
                                 -1, &mDBStatement, NULL);
  if (srv != SQLITE_OK) {
#ifdef PR_LOGGING
      PR_LOG(gStorageLog, PR_LOG_ERROR,
             ("Sqlite statement prepare error: %d '%s'", srv,
              ::sqlite3_errmsg(db)));
      PR_LOG(gStorageLog, PR_LOG_ERROR,
             ("Statement was: '%s'", PromiseFlatCString(mSQLString).get()));
#endif
      return NS_ERROR_FAILURE;
    }

#ifdef PR_LOGGING
  PR_LOG(gStorageLog, PR_LOG_NOTICE, ("Initialized statement '%s' (0x%p)",
                                      PromiseFlatCString(mSQLString).get(),
                                      mDBStatement));
#endif

  mParamCount = ::sqlite3_bind_parameter_count(mDBStatement);
  mResultColumnCount = ::sqlite3_column_count(mDBStatement);
  mColumnNames.Clear();

  for (PRUint32 i = 0; i < mResultColumnCount; i++) {
      const char *name = ::sqlite3_column_name(mDBStatement, i);
      (void)mColumnNames.AppendElement(nsDependentCString(name));
  }

#ifdef DEBUG
  // We want to try and test for LIKE and that consumers are using
  // escapeStringForLIKE instead of just trusting user input.  The idea to
  // check to see if they are binding a parameter after like instead of just
  // using a string.  We only do this in debug builds because it's expensive!
  const nsCaseInsensitiveCStringComparator c;
  nsACString::const_iterator start, end, e;
  mSQLString.BeginReading(start);
  mSQLString.EndReading(end);
  e = end;
  while (::FindInReadable(NS_LITERAL_CSTRING(" LIKE"), start, e, c)) {
    // We have a LIKE in here, so we perform our tests
    // FindInReadable moves the iterator, so we have to get a new one for
    // each test we perform.
    nsACString::const_iterator s1, s2, s3;
    s1 = s2 = s3 = start;

    if (!(::FindInReadable(NS_LITERAL_CSTRING(" LIKE ?"), s1, end, c) ||
          ::FindInReadable(NS_LITERAL_CSTRING(" LIKE :"), s2, end, c) ||
          ::FindInReadable(NS_LITERAL_CSTRING(" LIKE @"), s3, end, c))) {
      // At this point, we didn't find a LIKE statement followed by ?, :,
      // or @, all of which are valid characters for binding a parameter.
      // We will warn the consumer that they may not be safely using LIKE.
      NS_WARNING("Unsafe use of LIKE detected!  Please ensure that you "
                 "are using mozIStorageStatement::escapeStringForLIKE "
                 "and that you are binding that result to the statement "
                 "to prevent SQL injection attacks.");
    }

    // resetting start and e
    start = e;
    e = end;
  }
#endif

  return NS_OK;
}

nsresult
Statement::getAsynchronousStatementData(StatementData &_data)
{
  if (mFinalized)
    return NS_ERROR_UNEXPECTED;

  mPotentiallyLiveAsyncStatement = true;
  // mCachedAsyncStatement may be null at this point.  It's okay; the async
  // thread will call getAsyncStatement to initialize it.  This is desirable
  // because we don't want to end up acquiring the sqlite3 mutex on this thread.
  _data = StatementData(mCachedAsyncStatement, bindingParamsArray(), this);

  return NS_OK;
}

int
Statement::getAsyncStatement(sqlite3_stmt **_stmt)
{
  // If we have no statement, we shouldn't be calling this method!
  NS_ASSERTION(!mSQLString.IsVoid(),
               "We have no SQL to build an async statement from!");

  // If we do not yet have a cached async statement, clone our statement now.
  if (!mCachedAsyncStatement) {
    int rc = ::sqlite3_prepare_v2(mDBConnection->GetNativeConnection(),
                                  PromiseFlatCString(mSQLString).get(), -1,
                                  &mCachedAsyncStatement, NULL);
    if (rc != SQLITE_OK)
      return rc;

#ifdef PR_LOGGING
    PR_LOG(gStorageLog, PR_LOG_NOTICE, ("Created async statement '%s' (0x%p)",
                                        PromiseFlatCString(mSQLString).get(),
                                        mCachedAsyncStatement));
#endif
  }

  *_stmt = mCachedAsyncStatement;
  return SQLITE_OK;
}

BindingParams *
Statement::getParams()
{
  nsresult rv;

  // If we do not have an array object yet, make it.
  if (!mParamsArray) {
    nsCOMPtr<mozIStorageBindingParamsArray> array;
    rv = NewBindingParamsArray(getter_AddRefs(array));
    NS_ENSURE_SUCCESS(rv, nsnull);

    mParamsArray = static_cast<BindingParamsArray *>(array.get());
  }

  // If there isn't already any rows added, we'll have to add one to use.
  if (mParamsArray->length() == 0) {
    nsRefPtr<BindingParams> params(new BindingParams(mParamsArray, this));
    NS_ENSURE_TRUE(params, nsnull);

    rv = mParamsArray->AddParams(params);
    NS_ENSURE_SUCCESS(rv, nsnull);

    // We have to unlock our params because AddParams locks them.  This is safe
    // because no reference to the params object was, or ever will be given out.
    params->unlock();

    // We also want to lock our array at this point - we don't want anything to
    // be added to it.  Nothing has, or will ever get a reference to it, but we
    // will get additional safety checks via assertions by doing this.
    mParamsArray->lock();
  }

  return *mParamsArray->begin();
}

Statement::~Statement()
{
  mDestructing = true;
  (void)Finalize();
}

NS_IMPL_THREADSAFE_ADDREF(Statement)
NS_IMPL_THREADSAFE_RELEASE(Statement)

NS_INTERFACE_MAP_BEGIN(Statement)
  NS_INTERFACE_MAP_ENTRY(mozIStorageStatement)
  NS_INTERFACE_MAP_ENTRY(mozIStorageValueArray)
  if (aIID.Equals(NS_GET_IID(nsIClassInfo))) {
    foundInterface = static_cast<nsIClassInfo *>(&sStatementClassInfo);
  }
  else
  NS_INTERFACE_MAP_ENTRY(nsISupports)
NS_INTERFACE_MAP_END

////////////////////////////////////////////////////////////////////////////////
//// mozIStorageStatement

NS_IMETHODIMP
Statement::Clone(mozIStorageStatement **_statement)
{
  nsRefPtr<Statement> statement(new Statement());
  NS_ENSURE_TRUE(statement, NS_ERROR_OUT_OF_MEMORY);

  nsresult rv = statement->initialize(mDBConnection, mSQLString);
  NS_ENSURE_SUCCESS(rv, rv);

  statement.forget(_statement);
  return NS_OK;
}

NS_IMETHODIMP
Statement::Finalize()
{
  // Finalize can get called for two reasons:
  // 1) User-code called it because it is good about cleaning up.
  // 2) The destructor called it.  This is indicated by mDestructing.

  // Do not allow the synchronous statement to ever be re-created.
  mFinalized = true;

  int srv = NS_OK;
  // Cleanup down the synchronous statement if it got created.
  if (mDBStatement) {
#ifdef PR_LOGGING
    PR_LOG(gStorageLog, PR_LOG_NOTICE, ("Finalizing statement '%s'",
                                        ::sqlite3_sql(mDBStatement)));
#endif

    srv = ::sqlite3_finalize(mDBStatement);
    mDBStatement = NULL;
  }

  // Async Cleanup:
  //
  // We only need to do any cleanup if we have ever providing async data about
  // ourselves, which is tracked by mPotentiallyLiveAsyncStatement.
  //
  // Because AsyncExecuteStatements hold a reference to their owning statement,
  // this cannot be the destructor case if there are any async statements alive.
  // Therefore, if we are destructing, it's fine (and required) that we kill
  // the async statement if it is present.  If the async thread is no longer
  // available and we are not destructing, we still want to kill the async
  // statement; all of the pending async statements will have been canceled so
  // there is no possible further usage of the statement.
  //
  // Otherwise it is appropriate to dispatch an AsyncStatementFinalizer to clean
  // up the asynchronous statement.  Because we are not destructing in this
  // case, it is okay for the AsyncStatementFinalizer to have a reference to us.
  //
  // We want to void out mSQLString once we are sure the async statement is done
  // with it.  So we do this in all cases where we don't dispatch an
  // AsyncStatementFinalizer.
  if (mPotentiallyLiveAsyncStatement) {
    nsCOMPtr<nsIEventTarget> target = mDBConnection->getAsyncExecutionTarget();
    if (mCachedAsyncStatement && (mDestructing || !target)) {
      // However, if we cannot get the background thread, we have to assume it
      // has been shutdown (or is in the process of doing so).  As a result, we
      // should just finalize it here and now.
      (void)::sqlite3_finalize(mCachedAsyncStatement);
      mSQLString.SetIsVoid(PR_TRUE);
    }
    else if (!mDestructing && target) {
      nsCOMPtr<nsIRunnable> event = new AsyncStatementFinalizer(this);
      NS_ENSURE_TRUE(event, NS_ERROR_OUT_OF_MEMORY);

      nsresult rv = target->Dispatch(event, NS_DISPATCH_NORMAL);
      NS_ENSURE_SUCCESS(rv, rv);
    }
    else {
      mSQLString.SetIsVoid(PR_TRUE);
    }
  }
  else {
    mSQLString.SetIsVoid(PR_TRUE);
  }

  // We are considered dead at this point, so any wrappers for row or params
  // need to lose their reference to us.
  if (mStatementParamsHolder) {
    nsCOMPtr<nsIXPConnectWrappedNative> wrapper =
        do_QueryInterface(mStatementParamsHolder);
    nsCOMPtr<mozIStorageStatementParams> iParams =
        do_QueryWrappedNative(wrapper);
    StatementParams *params = static_cast<StatementParams *>(iParams.get());
    params->mStatement = nsnull;
    mStatementParamsHolder = nsnull;
  }

  if (mStatementRowHolder) {
    nsCOMPtr<nsIXPConnectWrappedNative> wrapper =
        do_QueryInterface(mStatementRowHolder);
    nsCOMPtr<mozIStorageStatementRow> iRow =
        do_QueryWrappedNative(wrapper);
    StatementRow *row = static_cast<StatementRow *>(iRow.get());
    row->mStatement = nsnull;
    mStatementRowHolder = nsnull;
  }

  return convertResultCode(srv);
}

void
Statement::cleanupAsyncStatement()
{
  if (mCachedAsyncStatement) {
    ::sqlite3_finalize(mCachedAsyncStatement);
    mCachedAsyncStatement = nsnull;
    mSQLString.SetIsVoid(PR_FALSE);
  }
  mPotentiallyLiveAsyncStatement = false;
}

NS_IMETHODIMP
Statement::GetParameterCount(PRUint32 *_parameterCount)
{
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);

  *_parameterCount = mParamCount;
  return NS_OK;
}

NS_IMETHODIMP
Statement::GetParameterName(PRUint32 aParamIndex,
                            nsACString &_name)
{
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);
  ENSURE_INDEX_VALUE(aParamIndex, mParamCount);

  const char *name = ::sqlite3_bind_parameter_name(mDBStatement,
                                                   aParamIndex + 1);
  if (name == NULL) {
    // this thing had no name, so fake one
    nsCAutoString name(":");
    name.AppendInt(aParamIndex);
    _name.Assign(name);
  }
  else {
    _name.Assign(nsDependentCString(name));
  }

  return NS_OK;
}

NS_IMETHODIMP
Statement::GetParameterIndex(const nsACString &aName,
                             PRUint32 *_index)
{
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);

  // We do not accept any forms of names other than ":name", but we need to add
  // the colon for SQLite.
  nsCAutoString name(":");
  name.Append(aName);
  int ind = ::sqlite3_bind_parameter_index(mDBStatement,
                                           PromiseFlatCString(name).get());
  if (ind  == 0) // Named parameter not found.
    return NS_ERROR_INVALID_ARG;

  *_index = ind - 1; // SQLite indexes are 1-based, we are 0-based.

  return NS_OK;
}

NS_IMETHODIMP
Statement::GetColumnCount(PRUint32 *_columnCount)
{
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);

  *_columnCount = mResultColumnCount;
  return NS_OK;
}

NS_IMETHODIMP
Statement::GetColumnName(PRUint32 aColumnIndex,
                         nsACString &_name)
{
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);
  ENSURE_INDEX_VALUE(aColumnIndex, mResultColumnCount);

  const char *cname = ::sqlite3_column_name(mDBStatement, aColumnIndex);
  _name.Assign(nsDependentCString(cname));

  return NS_OK;
}

NS_IMETHODIMP
Statement::GetColumnIndex(const nsACString &aName,
                          PRUint32 *_index)
{
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);

  // Surprisingly enough, SQLite doesn't provide an API for this.  We have to
  // determine it ourselves sadly.
  for (PRUint32 i = 0; i < mResultColumnCount; i++) {
    if (mColumnNames[i].Equals(aName)) {
      *_index = i;
      return NS_OK;
    }
  }

  return NS_ERROR_INVALID_ARG;
}

NS_IMETHODIMP
Statement::Reset()
{
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);

#ifdef DEBUG
  PR_LOG(gStorageLog, PR_LOG_DEBUG, ("Resetting statement: '%s'",
                                     ::sqlite3_sql(mDBStatement)));

  checkAndLogStatementPerformance(mDBStatement);
#endif

  mParamsArray = nsnull;
  (void)sqlite3_reset(mDBStatement);
  (void)sqlite3_clear_bindings(mDBStatement);

  mExecuting = false;

  return NS_OK;
}

NS_IMETHODIMP
Statement::BindUTF8StringParameter(PRUint32 aParamIndex,
                                   const nsACString &aValue)
{
  BindingParams *params = getParams();
  NS_ENSURE_TRUE(params, NS_ERROR_OUT_OF_MEMORY);

  return params->BindUTF8StringByIndex(aParamIndex, aValue);
}

NS_IMETHODIMP
Statement::BindStringParameter(PRUint32 aParamIndex,
                               const nsAString &aValue)
{
  BindingParams *params = getParams();
  NS_ENSURE_TRUE(params, NS_ERROR_OUT_OF_MEMORY);

  return params->BindStringByIndex(aParamIndex, aValue);
}

NS_IMETHODIMP
Statement::BindDoubleParameter(PRUint32 aParamIndex,
                               double aValue)
{
  BindingParams *params = getParams();
  NS_ENSURE_TRUE(params, NS_ERROR_OUT_OF_MEMORY);

  return params->BindDoubleByIndex(aParamIndex, aValue);
}

NS_IMETHODIMP
Statement::BindInt32Parameter(PRUint32 aParamIndex,
                              PRInt32 aValue)
{
  BindingParams *params = getParams();
  NS_ENSURE_TRUE(params, NS_ERROR_OUT_OF_MEMORY);

  return params->BindInt32ByIndex(aParamIndex, aValue);
}

NS_IMETHODIMP
Statement::BindInt64Parameter(PRUint32 aParamIndex,
                              PRInt64 aValue)
{
  BindingParams *params = getParams();
  NS_ENSURE_TRUE(params, NS_ERROR_OUT_OF_MEMORY);

  return params->BindInt64ByIndex(aParamIndex, aValue);
}

NS_IMETHODIMP
Statement::BindNullParameter(PRUint32 aParamIndex)
{
  BindingParams *params = getParams();
  NS_ENSURE_TRUE(params, NS_ERROR_OUT_OF_MEMORY);

  return params->BindNullByIndex(aParamIndex);
}

NS_IMETHODIMP
Statement::BindBlobParameter(PRUint32 aParamIndex,
                             const PRUint8 *aValue,
                             PRUint32 aValueSize)
{
  BindingParams *params = getParams();
  NS_ENSURE_TRUE(params, NS_ERROR_OUT_OF_MEMORY);

  return params->BindBlobByIndex(aParamIndex, aValue, aValueSize);
}

NS_IMETHODIMP
Statement::BindParameters(mozIStorageBindingParamsArray *aParameters)
{
  BindingParamsArray *array = static_cast<BindingParamsArray *>(aParameters);
  if (array->getOwner() != this)
    return NS_ERROR_UNEXPECTED;

  mParamsArray = array;
  mParamsArray->lock();

  return NS_OK;
}

NS_IMETHODIMP
Statement::NewBindingParamsArray(mozIStorageBindingParamsArray **_array)
{
  nsCOMPtr<mozIStorageBindingParamsArray> array =
    new BindingParamsArray(this);
  NS_ENSURE_TRUE(array, NS_ERROR_OUT_OF_MEMORY);

  array.forget(_array);
  return NS_OK;
}

NS_IMETHODIMP
Statement::Execute()
{
  PRBool ret;
  nsresult rv = ExecuteStep(&ret);
  NS_ENSURE_SUCCESS(rv, rv);

  return Reset();
}

NS_IMETHODIMP
Statement::ExecuteStep(PRBool *_moreResults)
{
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);

  // Bind any parameters first before executing.
  if (mParamsArray) {
    // If we have more than one row of parameters to bind, they shouldn't be
    // calling this method (and instead use executeAsync).
    if (mParamsArray->length() != 1)
      return NS_ERROR_UNEXPECTED;

    BindingParamsArray::iterator row = mParamsArray->begin();
    nsCOMPtr<mozIStorageError> error;
    error = (*row)->bind(mDBStatement);
    if (error) {
      PRInt32 srv;
      (void)error->GetResult(&srv);
      return convertResultCode(srv);
    }

    // We have bound, so now we can clear our array.
    mParamsArray = nsnull;
  }
  int srv = ::sqlite3_step(mDBStatement);

#ifdef PR_LOGGING
  if (srv != SQLITE_ROW && srv != SQLITE_DONE) {
      nsCAutoString errStr;
      (void)mDBConnection->GetLastErrorString(errStr);
      PR_LOG(gStorageLog, PR_LOG_DEBUG,
             ("Statement::ExecuteStep error: %s", errStr.get()));
  }
#endif

  // SQLITE_ROW and SQLITE_DONE are non-errors
  if (srv == SQLITE_ROW) {
    // we got a row back
    mExecuting = true;
    *_moreResults = PR_TRUE;
    return NS_OK;
  }
  else if (srv == SQLITE_DONE) {
    // statement is done (no row returned)
    mExecuting = false;
    *_moreResults = PR_FALSE;
    return NS_OK;
  }
  else if (srv == SQLITE_BUSY || srv == SQLITE_MISUSE) {
    mExecuting = PR_FALSE;
  }
  else if (mExecuting) {
#ifdef PR_LOGGING
    PR_LOG(gStorageLog, PR_LOG_ERROR,
           ("SQLite error after mExecuting was true!"));
#endif
    mExecuting = PR_FALSE;
  }

  return convertResultCode(srv);
}

nsresult
Statement::ExecuteAsync(mozIStorageStatementCallback *aCallback,
                        mozIStoragePendingStatement **_stmt)
{
  mozIStorageStatement *stmts[1] = {this};
  return mDBConnection->ExecuteAsync(stmts, 1, aCallback, _stmt);
}

NS_IMETHODIMP
Statement::GetState(PRInt32 *_state)
{
  // If someone is checking our state, they probably want us to have tried to
  // create the statement.
  (void)ensureSyncStatement();
  if (!mDBStatement)
    *_state = MOZ_STORAGE_STATEMENT_INVALID;
  else if (mExecuting)
    *_state = MOZ_STORAGE_STATEMENT_EXECUTING;
  else
    *_state = MOZ_STORAGE_STATEMENT_READY;

  return NS_OK;
}

NS_IMETHODIMP
Statement::EscapeStringForLIKE(const nsAString &aValue,
                               const PRUnichar aEscapeChar,
                               nsAString &_escapedString)
{
  const PRUnichar MATCH_ALL('%');
  const PRUnichar MATCH_ONE('_');

  _escapedString.Truncate(0);

  for (PRUint32 i = 0; i < aValue.Length(); i++) {
    if (aValue[i] == aEscapeChar || aValue[i] == MATCH_ALL ||
        aValue[i] == MATCH_ONE)
      _escapedString += aEscapeChar;
    _escapedString += aValue[i];
  }
  return NS_OK;
}

NS_IMETHODIMP
Statement::GetColumnDecltype(PRUint32 aParamIndex,
                             nsACString &_declType)
{
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);

  ENSURE_INDEX_VALUE(aParamIndex, mResultColumnCount);

  _declType.Assign(::sqlite3_column_decltype(mDBStatement, aParamIndex));
  return NS_OK;
}

////////////////////////////////////////////////////////////////////////////////
//// mozIStorageValueArray

NS_IMETHODIMP
Statement::GetNumEntries(PRUint32 *_length)
{
  // mResultColumnCount depends on the statement having been created
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);
  *_length = mResultColumnCount;
  return NS_OK;
}

NS_IMETHODIMP
Statement::GetTypeOfIndex(PRUint32 aIndex,
                          PRInt32 *_type)
{
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);

  ENSURE_INDEX_VALUE(aIndex, mResultColumnCount);

  if (!mExecuting)
    return NS_ERROR_UNEXPECTED;

  int t = ::sqlite3_column_type(mDBStatement, aIndex);
  switch (t) {
    case SQLITE_INTEGER:
      *_type = VALUE_TYPE_INTEGER;
      break;
    case SQLITE_FLOAT:
      *_type = VALUE_TYPE_FLOAT;
      break;
    case SQLITE_TEXT:
      *_type = VALUE_TYPE_TEXT;
      break;
    case SQLITE_BLOB:
      *_type = VALUE_TYPE_BLOB;
      break;
    case SQLITE_NULL:
      *_type = VALUE_TYPE_NULL;
      break;
    default:
      return NS_ERROR_FAILURE;
  }

  return NS_OK;
}

NS_IMETHODIMP
Statement::GetInt32(PRUint32 aIndex,
                    PRInt32 *_value)
{
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);

  ENSURE_INDEX_VALUE(aIndex, mResultColumnCount);

  if (!mExecuting)
    return NS_ERROR_UNEXPECTED;

  *_value = ::sqlite3_column_int(mDBStatement, aIndex);
  return NS_OK;
}

NS_IMETHODIMP
Statement::GetInt64(PRUint32 aIndex,
                    PRInt64 *_value)
{
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);

  ENSURE_INDEX_VALUE(aIndex, mResultColumnCount);

  if (!mExecuting)
    return NS_ERROR_UNEXPECTED;

  *_value = ::sqlite3_column_int64(mDBStatement, aIndex);

  return NS_OK;
}

NS_IMETHODIMP
Statement::GetDouble(PRUint32 aIndex,
                     double *_value)
{
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);

  ENSURE_INDEX_VALUE(aIndex, mResultColumnCount);

  if (!mExecuting)
    return NS_ERROR_UNEXPECTED;

  *_value = ::sqlite3_column_double(mDBStatement, aIndex);

  return NS_OK;
}

NS_IMETHODIMP
Statement::GetUTF8String(PRUint32 aIndex,
                         nsACString &_value)
{
  // Get type of Index will check aIndex for us, so we don't have to.
  PRInt32 type;
  nsresult rv = GetTypeOfIndex(aIndex, &type);
  NS_ENSURE_SUCCESS(rv, rv);
  if (type == VALUE_TYPE_NULL) {
    // NULL columns should have IsVod set to distinguis them from an empty
    // string.
    _value.Truncate(0);
    _value.SetIsVoid(PR_TRUE);
  }
  else {
    const char *value =
      reinterpret_cast<const char *>(::sqlite3_column_text(mDBStatement,
                                                           aIndex));
    _value.Assign(value, ::sqlite3_column_bytes(mDBStatement, aIndex));
  }
  return NS_OK;
}

NS_IMETHODIMP
Statement::GetString(PRUint32 aIndex,
                     nsAString &_value)
{
  // Get type of Index will check aIndex for us, so we don't have to.
  PRInt32 type;
  nsresult rv = GetTypeOfIndex(aIndex, &type);
  NS_ENSURE_SUCCESS(rv, rv);
  if (type == VALUE_TYPE_NULL) {
    // NULL columns should have IsVod set to distinguis them from an empty
    // string.
    _value.Truncate(0);
    _value.SetIsVoid(PR_TRUE);
  } else {
    const PRUnichar *value =
      static_cast<const PRUnichar *>(::sqlite3_column_text16(mDBStatement,
                                                             aIndex));
    _value.Assign(value, ::sqlite3_column_bytes16(mDBStatement, aIndex) / 2);
  }
  return NS_OK;
}

NS_IMETHODIMP
Statement::GetBlob(PRUint32 aIndex,
                   PRUint32 *_size,
                   PRUint8 **_blob)
{
  nsresult rv = ensureSyncStatement();
  NS_ENSURE_SUCCESS(rv, rv);

  ENSURE_INDEX_VALUE(aIndex, mResultColumnCount);

  if (!mExecuting)
     return NS_ERROR_UNEXPECTED;

  int size = ::sqlite3_column_bytes(mDBStatement, aIndex);
  void *blob = nsnull;
  if (size) {
    blob = nsMemory::Clone(::sqlite3_column_blob(mDBStatement, aIndex), size);
    NS_ENSURE_TRUE(blob, NS_ERROR_OUT_OF_MEMORY);
  }

  *_blob = static_cast<PRUint8 *>(blob);
  *_size = size;
  return NS_OK;
}

NS_IMETHODIMP
Statement::GetSharedUTF8String(PRUint32 aIndex,
                               PRUint32 *_length,
                               const char **_value)
{
  if (_length)
    *_length = ::sqlite3_column_bytes(mDBStatement, aIndex);

  *_value = reinterpret_cast<const char *>(::sqlite3_column_text(mDBStatement,
                                                                 aIndex));
  return NS_OK;
}

NS_IMETHODIMP
Statement::GetSharedString(PRUint32 aIndex,
                           PRUint32 *_length,
                           const PRUnichar **_value)
{
  if (_length)
    *_length = ::sqlite3_column_bytes16(mDBStatement, aIndex);

  *_value = static_cast<const PRUnichar *>(::sqlite3_column_text16(mDBStatement,
                                                                   aIndex));
  return NS_OK;
}

NS_IMETHODIMP
Statement::GetSharedBlob(PRUint32 aIndex,
                         PRUint32 *_size,
                         const PRUint8 **_blob)
{
  *_size = ::sqlite3_column_bytes(mDBStatement, aIndex);
  *_blob = static_cast<const PRUint8 *>(::sqlite3_column_blob(mDBStatement,
                                                              aIndex));
  return NS_OK;
}

NS_IMETHODIMP
Statement::GetIsNull(PRUint32 aIndex,
                     PRBool *_isNull)
{
  // Get type of Index will check aIndex for us, so we don't have to.
  PRInt32 type;
  nsresult rv = GetTypeOfIndex(aIndex, &type);
  NS_ENSURE_SUCCESS(rv, rv);
  *_isNull = (type == VALUE_TYPE_NULL);
  return NS_OK;
}

} // namespace storage
} // namespace mozilla
