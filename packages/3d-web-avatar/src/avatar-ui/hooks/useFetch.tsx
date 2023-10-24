import { useEffect, useState } from "react";

export type AssetDescriptions = Record<
  string,
  {
    name: string;
    asset: string;
    thumb: string;
  }
>;

export type CollectionDataType = {
  head: AssetDescriptions[];
  upperBody: AssetDescriptions[];
  lowerBody: AssetDescriptions[];
  feet: AssetDescriptions[];
};

export const useFetch = (url: string) => {
  const [collectionData, setCollectionData] = useState<CollectionDataType | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);

  useEffect(() => {
    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Response for fetching ${url} was not ok `);
        }
        return response.json();
      })
      .then((data) => {
        setCollectionData(data);
        setLoading(false);
      })
      .catch((error) => {
        setLoadingError(error.message);
        setLoading(false);
      });
  }, [url]);

  return [collectionData, loading, loadingError];
};
