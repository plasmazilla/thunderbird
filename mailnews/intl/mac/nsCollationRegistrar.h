/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef _nsCollationRegistrar_h_
#define _nsCollationRegistrar_h_

#include "nsIObserver.h"

// {BA495E08-7255-46C6-9DED-4A9D434349EB}
#define NS_COLLATION_REGISTRAR_CID \
{ 0xba495e08, 0x7255, 0x46c6, \
{ 0x9d, 0xed, 0x4a, 0x9d, 0x43, 0x43, 0x49, 0xeb } }

#define NS_COLLATION_REGISTRAR_CONTRACTID \
"@mozilla.org/messenger/collation-registrar;1"

class nsCollationRegistrar MOZ_FINAL : public nsIObserver {
  ~nsCollationRegistrar() {}

  nsresult IsJapanese(bool* out);
  nsresult Register();
public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIOBSERVER
  nsCollationRegistrar() {}
};

#endif  /* _nsCollationRegistrar_h_ */
