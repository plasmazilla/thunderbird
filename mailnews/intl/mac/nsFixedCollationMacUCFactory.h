/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef _nsFixedCollationMacUCFactory_h_
#define _nsFixedCollationMacUCFactory_h_

#include "nsIFactory.h"

class nsFixedCollationMacUCFactory MOZ_FINAL : public nsIFactory {
  ~nsFixedCollationMacUCFactory() {}
public:
  NS_DECL_ISUPPORTS
  nsFixedCollationMacUCFactory() {}

  NS_IMETHOD CreateInstance(nsISupports *aOuter, const nsIID &aIID,
                            void **aResult);
  NS_IMETHOD LockFactory(bool aLock);
};

#endif  /* _nsFixedCollationMacUCFactory_h_ */
