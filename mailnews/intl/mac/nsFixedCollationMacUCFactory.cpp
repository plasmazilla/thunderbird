/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsCollationMacUC.h"
#include "nsFixedCollationMacUCFactory.h"
#include "nsICollation.h"

NS_IMPL_ISUPPORTS(nsFixedCollationMacUCFactory, nsIFactory)

NS_IMETHODIMP nsFixedCollationMacUCFactory::CreateInstance(nsISupports* aOuter,
                                                           const nsID& aIID,
                                                           void** aResult)
{
  NS_ENSURE_NO_AGGREGATION(aOuter);

  nsCOMPtr<nsICollation> instance = new mailnews::nsCollationMacUC();
  NS_ENSURE_TRUE(instance, NS_ERROR_OUT_OF_MEMORY);
  return instance->QueryInterface(aIID, aResult);
}

NS_IMETHODIMP nsFixedCollationMacUCFactory::LockFactory(bool aVal)
{
  return NS_OK;
}
