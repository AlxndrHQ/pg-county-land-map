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

    # ---- Washington, DC ----
    "DC": {"name": "Washington, DC", "state": "DC",
           "layer": "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land_WebMercator/MapServer/40",
           "where": "1=1", "fields": ["*"], "page": 2000},

    # ---- Virginia ----
    "AL": {"name": "City of Alexandria, VA", "state": "VA",
           "layer": "https://services2.arcgis.com/ChYV69FhfjwkvRmy/arcgis/rest/services/Alexandria_Parcels/FeatureServer/0",
           "where": "1=1", "fields": ["*"], "page": 2000},
    "AL_values": {"name": "Alexandria assessed values", "state": "VA",
           "layer": "https://maps.alexandriava.gov/arcgis/rest/services/alxLandWm/MapServer/1",
           "where": "1=1", "fields": ["OBJECTID", "ACCOUNTNO", "LAND_CYR", "IMP_CYR", "TOT_CYR"], "page": 1000, "geometry": False},
    "FX": {"name": "Fairfax County, VA", "state": "VA", "layer": "https://services1.arcgis.com/ioennV6PpG5Xodq0/ArcGIS/rest/services/Parcels/FeatureServer/0",
           "where": "1=1", "fields": ["OBJECTID", "PIN", "PARCEL_TYPE"], "page": 2000},
    "FX_values": {"name": "Fairfax assessed values", "state": "VA", "layer": "https://services1.arcgis.com/ioennV6PpG5Xodq0/ArcGIS/rest/services/Tax_Administration_Real_Estate_Assessed_Values/FeatureServer/0",
           "where": "1=1", "fields": ["OBJECTID", "PARID", "APRLAND", "APRBLDG", "APRTOT", "FLAG4_DESC"], "page": 2000, "geometry": False},
    "FX_use": {"name": "Fairfax parcel data", "state": "VA", "layer": "https://services1.arcgis.com/ioennV6PpG5Xodq0/ArcGIS/rest/services/Tax_Administration_Real_Estate_Parcels_Data/FeatureServer/0",
           "where": "1=1", "fields": ["OBJECTID", "PARID", "LUC_DESC", "ZONING_DESC", "LIVUNIT"], "page": 2000, "geometry": False},
    "FX_legal": {"name": "Fairfax legal data", "state": "VA", "layer": "https://services1.arcgis.com/ioennV6PpG5Xodq0/ArcGIS/rest/services/Tax_Administration_Real_Estate_Legal_Data/FeatureServer/0",
           "where": "1=1", "fields": ["OBJECTID", "PARID", "ACRES", "ADRNO", "ADRADD", "ADRDIR", "ADRSTR", "ADRSUF", "CITYNAME", "ZIP1"],
           "page": 2000, "geometry": False},
    "PW": {"name": "Prince William County, VA", "state": "VA",
           "layer": "https://gisweb.pwcva.gov/arcgis/rest/services/GTS/CAMA_Parcels/MapServer/4",
           "where": "1=1", "page": 2000,   # this server answers each request after about 60 s
           "fields": ["OBJECTID", "GPIN", "Acreage", "StreetNumber", "StreetName", "StreetType", "UnitNumber", "City",
                      "ZipCode", "DeedInstrument", "DeedBook", "DeedPage", "CAMA_OWNER_CUR", "CAMA_ADDRESS2", "CAMA_ADDRESS3",
                      "CAMA_CITY", "CAMA_STATE", "CAMA_ZIPCODE", "CAMA_USECODE", "CAMA_Account", "CAMA_TaxAcreage1"]},
    "LO": {"name": "Loudoun County, VA", "state": "VA",
           "layer": "https://logis.loudoun.gov/gis/rest/services/COL/LandRecords/MapServer/5",
           "where": "1=1", "fields": ["OBJECTID", "PA_MCPI", "PA_LEGAL_ACRE", "PA_SUBD_NAME", "PA_TYPE", "PA_UNITS"], "page": 2000},
    "FQ": {"name": "Fauquier County, VA", "state": "VA",
           "layer": "https://services.arcgis.com/oAoeYJ1kqmAwcEC2/arcgis/rest/services/Tax_Parcels_DL/FeatureServer/0",
           "where": "1=1", "fields": ["*"], "page": 2000, "oid": "FID"},
    "AR": {"name": "Arlington County, VA", "state": "VA",
           "layer": "https://arlgis.arlingtonva.us/arcgis/rest/services/Public_Maps/Parcel_Map/FeatureServer/1",
           "where": "1=1", "fields": ["OBJECTID", "RPCMSTR", "GeoSyncDate"], "page": 2000},
}
