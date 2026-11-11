"""Parcel sources beyond Prince George's County.

Each source is one ArcGIS layer (plus, where needed, a separate owner table). The jurisdiction
code prefixes every parcel id from that source (PG keeps bare ids so saved projects still work),
names the cache folder data/raw/<code>/ and the data folder web/data/<code>/.
"""

MD_IMAP = "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0"
MD_FIELDS = [
    "OBJECTID", "JURSCODE", "ACCTID", "ADDRESS", "CITY", "ZIPCODE",
    "OWNADD1", "OWNADD2", "OWNCITY", "OWNSTATE", "OWNERZIP",
    "DR1LIBER", "DR1FOLIO", "ZONING", "CIUSE", "DESCCIUSE", "EXCLASS", "DESCEXCL", "LU", "DESCLU",
    "ACRES", "YEARBLT", "TRADATE", "CONSIDR1", "NFMLNDVL", "NFMIMPVL", "NFMTTLVL",
    "SDATWEBADR", "SDATDATE", "OOI", "RESITYP", "PTYPE", "BLDG_UNITS",
]

SOURCES = {
    "AA": {"name": "Anne Arundel County, MD", "state": "MD", "layer": MD_IMAP,
           "where": "JURSCODE='ANNE'", "fields": MD_FIELDS, "page": 1000},
    "MO": {"name": "Montgomery County, MD", "state": "MD", "layer": MD_IMAP,
           "where": "JURSCODE='MONT'", "fields": MD_FIELDS, "page": 1000},
    "CH": {"name": "Charles County, MD", "state": "MD", "layer": MD_IMAP,
           "where": "JURSCODE='CHAR'", "fields": MD_FIELDS, "page": 1000},

    "HO": {"name": "Howard County, MD", "state": "MD", "layer": MD_IMAP,
           "where": "JURSCODE='HOWA'", "fields": MD_FIELDS, "page": 1000},

    # Owner names (MD iMAP has none). Attribute-only tables joined to MD iMAP on ACCTID.
    "AA_names": {"name": "Anne Arundel County Planning and Zoning (owner names)", "state": "MD",
                 "layer": "https://gis.aacounty.org/arcgis/rest/services/OpenData/Planning_OpenData/MapServer/34",
                 "where": "1=1", "fields": ["OBJECTID", "ASST_ACCOUNT_NO", "ASST_FIRST_OWNER", "ASST_SECND_OWNER"],
                 "page": 2000, "geometry": False, "join": lambda r: "020" + (r.get("ASST_ACCOUNT_NO") or "")},
    "CH_names": {"name": "Charles County tax parcels (owner names)", "state": "MD",
                 "layer": "https://services7.arcgis.com/3BMWkdyrt45RNCrq/arcgis/rest/services/Tax_Parcels_(View)/FeatureServer/0",
                 "where": "1=1", "fields": ["FID", "ACCTID", "OWNNAME1", "OWNNAME2"], "oid": "FID",
                 "page": 2000, "geometry": False, "join": lambda r: r.get("ACCTID") or ""},
}
