/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
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
 * The Original Code is Places.
 *
 * The Initial Developer of the Original Code is Mozilla Corporation.
 * Portions created by the Initial Developer are Copyright (C) 2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Mark Finkle <mfinkle@mozilla.com> (original author)
 *   Shawn Wilsher <me@shawnwilsher.com>
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

#include "prtypes.h"

/**
 * Because of our branch only interfaces, our ENUMERATE_OBSERVERS macro has to
 * get a little bit more complicated.  This templated struct provides typedefs
 * to make it all easier without complicating the call sites.
 */
namespace {
  template <typename T>
  struct NotificationTypeConverter
  {
    typedef T ArrayType;
    typedef T QIType;
  };
  template < >
  struct NotificationTypeConverter<nsINavHistoryObserver_MOZILLA_1_9_1_ADDITIONS>
  {
    typedef nsINavHistoryObserver ArrayType;
    typedef nsINavHistoryObserver_MOZILLA_1_9_1_ADDITIONS QIType;
  };
  template < >
  struct NotificationTypeConverter<nsINavBookmarkObserver_MOZILLA_1_9_1_ADDITIONS>
  {
    typedef nsINavBookmarkObserver ArrayType;
    typedef nsINavBookmarkObserver_MOZILLA_1_9_1_ADDITIONS QIType;
  };
}

// Call a method on each observer in a category cache, then call the same
// method on the observer array.

#define ENUMERATE_OBSERVERS(canFire, cache, array, type, method)               \
  PR_BEGIN_MACRO                                                               \
  if (canFire) {                                                               \
    const nsCOMArray<NotificationTypeConverter<type>::ArrayType> &entries =    \
      cache.GetEntries();                                                      \
    for (PRInt32 idx = 0; idx < entries.Count(); ++idx) {                      \
      nsCOMPtr<NotificationTypeConverter<type>::QIType> entry =                \
       do_QueryInterface(entries[idx]);                                        \
      if (entry)                                                               \
        entry->method;                                                         \
    }                                                                          \
    ENUMERATE_WEAKARRAY(array, type, method)                                   \
  }                                                                            \
  PR_END_MACRO;

