import { parseLibraryJSON } from "@excalidraw/excalidraw/data/blob";

import awsArchitectureIconsUrl from "../../IconLibraries/aws-architecture-icons.excalidrawlib?url";
import azureCloudServicesUrl from "../../IconLibraries/azure-cloud-services.excalidrawlib?url";
import azureComputeUrl from "../../IconLibraries/azure-compute.excalidrawlib?url";
import azureGeneralUrl from "../../IconLibraries/azure-general.excalidrawlib?url";
import azureNetworkUrl from "../../IconLibraries/azure-network.excalidrawlib?url";
import azureStorageUrl from "../../IconLibraries/azure-storage.excalidrawlib?url";
import dataPlatformUrl from "../../IconLibraries/data-platform.excalidrawlib?url";
import dataProcessingUrl from "../../IconLibraries/data-processing.excalidrawlib?url";
import dataScienceUrl from "../../IconLibraries/data-science.excalidrawlib?url";
import deepLearningUrl from "../../IconLibraries/deep-learning.excalidrawlib?url";
import googleIconsUrl from "../../IconLibraries/google-icons.excalidrawlib?url";
import iconsUrl from "../../IconLibraries/icons.excalidrawlib?url";
import logosUrl from "../../IconLibraries/logos.excalidrawlib?url";
import mathematicalSymbolsUrl from "../../IconLibraries/mathematical-symbols.excalidrawlib?url";
import microsoft365IconsUrl from "../../IconLibraries/microsoft-365-icons.excalidrawlib?url";
import microsoftAzureCloudIconsUrl from "../../IconLibraries/microsoft-azure-cloud-icons.excalidrawlib?url";
import snowflakeIconographyUrl from "../../IconLibraries/snowflake-iconography.excalidrawlib?url";
import someHanddrawnSignsUrl from "../../IconLibraries/some-handdrawn-signs.excalidrawlib?url";
import vmwareArchitectureDesignUrl from "../../IconLibraries/vmware-architecture-design.excalidrawlib?url";

import type {
  LibraryItem,
  LibraryItems,
} from "@excalidraw/excalidraw/types";

/** Exactly the 19 named libraries under `aifaboard/IconLibraries`. */
const bundledLibraries = [
  { url: awsArchitectureIconsUrl, category: "aws architecture icons" },
  { url: azureCloudServicesUrl, category: "azure cloud services" },
  { url: azureComputeUrl, category: "azure compute" },
  { url: azureGeneralUrl, category: "azure general" },
  { url: azureNetworkUrl, category: "azure network" },
  { url: azureStorageUrl, category: "azure storage" },
  { url: dataPlatformUrl, category: "data platform" },
  { url: dataProcessingUrl, category: "data processing" },
  { url: dataScienceUrl, category: "data science" },
  { url: deepLearningUrl, category: "deep learning" },
  { url: googleIconsUrl, category: "google icons" },
  { url: iconsUrl, category: "icons" },
  { url: logosUrl, category: "logos" },
  { url: mathematicalSymbolsUrl, category: "mathematical symbols" },
  { url: microsoft365IconsUrl, category: "microsoft 365 icons" },
  { url: microsoftAzureCloudIconsUrl, category: "microsoft azure cloud icons" },
  { url: snowflakeIconographyUrl, category: "snowflake iconography" },
  { url: someHanddrawnSignsUrl, category: "some handdrawn signs" },
  { url: vmwareArchitectureDesignUrl, category: "vmware architecture design" },
];

const getLibraryItemContentKey = (item: LibraryItem) =>
  item.elements
    .map((element) => `${element.id}:${element.versionNonce}`)
    .join("|");

const isLegacyGeneratedBundledName = (name: string) =>
  /^(Architecture|Cloud|Data|DevOps|Draw\.io|Software|System)\s+\d+$/i.test(
    name,
  );

export const mergeBundledIconLibraryItems = (
  currentItems: LibraryItems,
  bundledItems: LibraryItems,
): LibraryItems => {
  const bundledKeys = new Set(bundledItems.map(getLibraryItemContentKey));
  const bundledBaseNames = new Set(
    bundledItems.map((item) => item.name?.split("|")[0]?.trim() || ""),
  );
  return [
    ...bundledItems,
    ...currentItems.filter(
      (item) => {
        const baseName = item.name?.split("|")[0]?.trim() || "";
        return (
          !bundledKeys.has(getLibraryItemContentKey(item)) &&
          !bundledBaseNames.has(baseName) &&
          !isLegacyGeneratedBundledName(baseName)
        );
      },
    ),
  ];
};

export async function loadBundledIconLibraryItems(): Promise<LibraryItems> {
  const librarySources = await Promise.all(
    bundledLibraries.map(async (library) => {
      const response = await fetch(library.url);
      if (!response.ok) {
        throw new Error(`Failed to load bundled library ${library.url}`);
      }
      return {
        source: await response.text(),
        category: library.category,
      };
    }),
  );

  return librarySources.flatMap(({ source, category }) => {
    try {
      return parseLibraryJSON(source, "unpublished").map((item) => {
        const displayName = item.name?.split("|")[0]?.trim() || "";
        return {
          ...item,
          name: `${displayName} | #cat:${category}`,
        };
      });
    } catch (error) {
      console.warn("Failed to parse bundled Excalidraw icon library", error);
      return [];
    }
  });
}
