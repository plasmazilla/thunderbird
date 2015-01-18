/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/ModuleUtils.h"
#include "nsCollationRegistrar.h"
#include "nsID.h"
#include "nsXPCOM.h"

NS_GENERIC_FACTORY_CONSTRUCTOR(nsCollationRegistrar)

NS_DEFINE_NAMED_CID(NS_COLLATION_REGISTRAR_CID);

static const mozilla::Module::CategoryEntry kCollationRegistrarCategories[] = {
  { NS_XPCOM_STARTUP_CATEGORY, "nsCollationRegistrar", NS_COLLATION_REGISTRAR_CONTRACTID },
  { nullptr }
};

const mozilla::Module::CIDEntry kCollationRegistrarCIDs[] = {
  { &kNS_COLLATION_REGISTRAR_CID, false, nullptr, nsCollationRegistrarConstructor },
  { nullptr }
};

const mozilla::Module::ContractIDEntry kCollationRegistrarContracts[] = {
  { NS_COLLATION_REGISTRAR_CONTRACTID, &kNS_COLLATION_REGISTRAR_CID },
  { nullptr }
};

static const mozilla::Module kCollationRegistrarModule = {
  mozilla::Module::kVersion,
  kCollationRegistrarCIDs,
  kCollationRegistrarContracts,
  kCollationRegistrarCategories
};

NSMODULE_DEFN(nsCollationRegistrar) = &kCollationRegistrarModule;
