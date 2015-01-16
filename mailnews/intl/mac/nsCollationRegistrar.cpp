/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsCollationCID.h"
#include "nsCollationRegistrar.h"
#include "nsFixedCollationMacUCFactory.h"
#include "nsIComponentRegistrar.h"
#include "nsILocaleService.h"
#include "nsServiceManagerUtils.h"
#include "nsString.h"

NS_IMPL_ISUPPORTS(nsCollationRegistrar, nsIObserver)

nsresult nsCollationRegistrar::IsJapanese(bool* isJapanese)
{
  *isJapanese = false;

  nsresult rv;
  nsCOMPtr<nsILocaleService> localeService = do_GetService(NS_LOCALESERVICE_CONTRACTID, &rv);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsILocale> systemLocale;
  rv = localeService->GetSystemLocale(getter_AddRefs(systemLocale));
  NS_ENSURE_SUCCESS(rv, rv);

  nsAutoString localeString;
  rv = systemLocale->GetCategory(NS_LITERAL_STRING("NSILOCALE_COLLATE"), localeString);
  NS_ENSURE_SUCCESS(rv, rv);

  if (localeString.Length() >= 2 &&
      localeString[0] == 'j' && localeString[1] == 'a') {
    *isJapanese = true;
  }

  return NS_OK;
}

nsresult nsCollationRegistrar::Register()
{
  nsresult rv;
  nsCOMPtr<nsIComponentRegistrar> registrar;
  rv = NS_GetComponentRegistrar(getter_AddRefs(registrar));
  NS_ENSURE_SUCCESS(rv, rv);

  // We must register fixed nsCollationMacUC after original one.
  bool registered;
  rv = registrar->IsContractIDRegistered(NS_COLLATION_CONTRACTID, &registered);
  NS_ENSURE_SUCCESS(rv, rv);
  NS_ENSURE_TRUE(registered, NS_ERROR_UNEXPECTED);

  nsCOMPtr<nsIFactory> originalFactory;
  originalFactory = do_GetClassObject(NS_COLLATION_CONTRACTID, &rv);
  NS_ENSURE_SUCCESS(rv, rv);
  rv = registrar->UnregisterFactory(NS_COLLATION_CID, originalFactory);
  NS_ENSURE_SUCCESS(rv, rv);

  nsIFactory* fixedFactory = new nsFixedCollationMacUCFactory();
  NS_ENSURE_TRUE(fixedFactory, NS_ERROR_OUT_OF_MEMORY);
  return registrar->RegisterFactory(NS_COLLATION_CID, "Fixed nsCollationMacUC",
                                    NS_COLLATION_CONTRACTID, fixedFactory);
}

NS_IMETHODIMP nsCollationRegistrar::Observe(nsISupports* aSubject,
                                            const char* aTopic,
                                            const char16_t* aData)
{
  if (strcmp(aTopic, NS_XPCOM_STARTUP_CATEGORY) == 0) {
    nsresult rv;
    bool isJapanese = false;
    rv = IsJapanese(&isJapanese);
    NS_ENSURE_SUCCESS(rv, rv);
    if (isJapanese) {
      rv = Register();
      NS_ENSURE_SUCCESS(rv, rv);
    }
  }

  return NS_OK;
}

