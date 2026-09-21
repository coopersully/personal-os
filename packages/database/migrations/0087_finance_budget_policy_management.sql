-- Frozen named zones accepted by the public Intl parser at migration authoring.
CREATE FUNCTION finance_budget_policy_timezone(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(translate(value,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') = ANY(ARRAY['africa/abidjan','africa/accra','africa/addis_ababa','africa/algiers','africa/asmara','africa/asmera','africa/bamako','africa/bangui','africa/banjul','africa/bissau','africa/blantyre','africa/brazzaville','africa/bujumbura','africa/cairo','africa/casablanca','africa/ceuta','africa/conakry','africa/dakar','africa/dar_es_salaam','africa/djibouti','africa/douala','africa/el_aaiun','africa/freetown','africa/gaborone','africa/harare','africa/johannesburg','africa/juba','africa/kampala','africa/khartoum','africa/kigali','africa/kinshasa','africa/lagos','africa/libreville','africa/lome','africa/luanda','africa/lubumbashi','africa/lusaka','africa/malabo','africa/maputo','africa/maseru','africa/mbabane','africa/mogadishu','africa/monrovia','africa/nairobi','africa/ndjamena','africa/niamey','africa/nouakchott','africa/ouagadougou','africa/porto-novo','africa/sao_tome','africa/timbuktu','africa/tripoli','africa/tunis','africa/windhoek','america/adak','america/anchorage','america/anguilla','america/antigua','america/araguaina','america/argentina/buenos_aires','america/argentina/catamarca','america/argentina/comodrivadavia','america/argentina/cordoba','america/argentina/jujuy','america/argentina/la_rioja','america/argentina/mendoza','america/argentina/rio_gallegos','america/argentina/salta','america/argentina/san_juan','america/argentina/san_luis','america/argentina/tucuman','america/argentina/ushuaia','america/aruba','america/asuncion','america/atikokan','america/atka','america/bahia','america/bahia_banderas','america/barbados','america/belem','america/belize','america/blanc-sablon','america/boa_vista','america/bogota','america/boise','america/buenos_aires','america/cambridge_bay','america/campo_grande','america/cancun','america/caracas','america/catamarca','america/cayenne','america/cayman','america/chicago','america/chihuahua','america/ciudad_juarez','america/coral_harbour','america/cordoba','america/costa_rica','america/coyhaique','america/creston','america/cuiaba','america/curacao','america/danmarkshavn','america/dawson','america/dawson_creek','america/denver','america/detroit','america/dominica','america/edmonton','america/eirunepe','america/el_salvador','america/ensenada','america/fort_nelson','america/fort_wayne','america/fortaleza','america/glace_bay','america/godthab','america/goose_bay','america/grand_turk','america/grenada','america/guadeloupe','america/guatemala','america/guayaquil','america/guyana','america/halifax','america/havana','america/hermosillo','america/indiana/indianapolis','america/indiana/knox','america/indiana/marengo','america/indiana/petersburg','america/indiana/tell_city','america/indiana/vevay','america/indiana/vincennes','america/indiana/winamac','america/indianapolis','america/inuvik','america/iqaluit','america/jamaica','america/jujuy','america/juneau','america/kentucky/louisville','america/kentucky/monticello','america/knox_in','america/kralendijk','america/la_paz','america/lima','america/los_angeles','america/louisville','america/lower_princes','america/maceio','america/managua','america/manaus','america/marigot','america/martinique','america/matamoros','america/mazatlan','america/mendoza','america/menominee','america/merida','america/metlakatla','america/mexico_city','america/miquelon','america/moncton','america/monterrey','america/montevideo','america/montreal','america/montserrat','america/nassau','america/new_york','america/nipigon','america/nome','america/noronha','america/north_dakota/beulah','america/north_dakota/center','america/north_dakota/new_salem','america/nuuk','america/ojinaga','america/panama','america/pangnirtung','america/paramaribo','america/phoenix','america/port-au-prince','america/port_of_spain','america/porto_acre','america/porto_velho','america/puerto_rico','america/punta_arenas','america/rainy_river','america/rankin_inlet','america/recife','america/regina','america/resolute','america/rio_branco','america/rosario','america/santa_isabel','america/santarem','america/santiago','america/santo_domingo','america/sao_paulo','america/scoresbysund','america/shiprock','america/sitka','america/st_barthelemy','america/st_johns','america/st_kitts','america/st_lucia','america/st_thomas','america/st_vincent','america/swift_current','america/tegucigalpa','america/thule','america/thunder_bay','america/tijuana','america/toronto','america/tortola','america/vancouver','america/virgin','america/whitehorse','america/winnipeg','america/yakutat','america/yellowknife','antarctica/casey','antarctica/davis','antarctica/dumontdurville','antarctica/macquarie','antarctica/mawson','antarctica/mcmurdo','antarctica/palmer','antarctica/rothera','antarctica/south_pole','antarctica/syowa','antarctica/troll','antarctica/vostok','arctic/longyearbyen','asia/aden','asia/almaty','asia/amman','asia/anadyr','asia/aqtau','asia/aqtobe','asia/ashgabat','asia/ashkhabad','asia/atyrau','asia/baghdad','asia/bahrain','asia/baku','asia/bangkok','asia/barnaul','asia/beirut','asia/bishkek','asia/brunei','asia/calcutta','asia/chita','asia/choibalsan','asia/chongqing','asia/chungking','asia/colombo','asia/dacca','asia/damascus','asia/dhaka','asia/dili','asia/dubai','asia/dushanbe','asia/famagusta','asia/gaza','asia/harbin','asia/hebron','asia/ho_chi_minh','asia/hong_kong','asia/hovd','asia/irkutsk','asia/istanbul','asia/jakarta','asia/jayapura','asia/jerusalem','asia/kabul','asia/kamchatka','asia/karachi','asia/kashgar','asia/kathmandu','asia/katmandu','asia/khandyga','asia/kolkata','asia/krasnoyarsk','asia/kuala_lumpur','asia/kuching','asia/kuwait','asia/macao','asia/macau','asia/magadan','asia/makassar','asia/manila','asia/muscat','asia/nicosia','asia/novokuznetsk','asia/novosibirsk','asia/omsk','asia/oral','asia/phnom_penh','asia/pontianak','asia/pyongyang','asia/qatar','asia/qostanay','asia/qyzylorda','asia/rangoon','asia/riyadh','asia/saigon','asia/sakhalin','asia/samarkand','asia/seoul','asia/shanghai','asia/singapore','asia/srednekolymsk','asia/taipei','asia/tashkent','asia/tbilisi','asia/tehran','asia/tel_aviv','asia/thimbu','asia/thimphu','asia/tokyo','asia/tomsk','asia/ujung_pandang','asia/ulaanbaatar','asia/ulan_bator','asia/urumqi','asia/ust-nera','asia/vientiane','asia/vladivostok','asia/yakutsk','asia/yangon','asia/yekaterinburg','asia/yerevan','atlantic/azores','atlantic/bermuda','atlantic/canary','atlantic/cape_verde','atlantic/faeroe','atlantic/faroe','atlantic/jan_mayen','atlantic/madeira','atlantic/reykjavik','atlantic/south_georgia','atlantic/st_helena','atlantic/stanley','australia/act','australia/adelaide','australia/brisbane','australia/broken_hill','australia/canberra','australia/currie','australia/darwin','australia/eucla','australia/hobart','australia/lhi','australia/lindeman','australia/lord_howe','australia/melbourne','australia/nsw','australia/north','australia/perth','australia/queensland','australia/south','australia/sydney','australia/tasmania','australia/victoria','australia/west','australia/yancowinna','brazil/acre','brazil/denoronha','brazil/east','brazil/west','cet','cst6cdt','canada/atlantic','canada/central','canada/eastern','canada/mountain','canada/newfoundland','canada/pacific','canada/saskatchewan','canada/yukon','chile/continental','chile/easterisland','cuba','eet','est','est5edt','egypt','eire','etc/gmt','etc/gmt+0','etc/gmt+1','etc/gmt+10','etc/gmt+11','etc/gmt+12','etc/gmt+2','etc/gmt+3','etc/gmt+4','etc/gmt+5','etc/gmt+6','etc/gmt+7','etc/gmt+8','etc/gmt+9','etc/gmt-0','etc/gmt-1','etc/gmt-10','etc/gmt-11','etc/gmt-12','etc/gmt-13','etc/gmt-14','etc/gmt-2','etc/gmt-3','etc/gmt-4','etc/gmt-5','etc/gmt-6','etc/gmt-7','etc/gmt-8','etc/gmt-9','etc/gmt0','etc/greenwich','etc/uct','etc/utc','etc/universal','etc/zulu','europe/amsterdam','europe/andorra','europe/astrakhan','europe/athens','europe/belfast','europe/belgrade','europe/berlin','europe/bratislava','europe/brussels','europe/bucharest','europe/budapest','europe/busingen','europe/chisinau','europe/copenhagen','europe/dublin','europe/gibraltar','europe/guernsey','europe/helsinki','europe/isle_of_man','europe/istanbul','europe/jersey','europe/kaliningrad','europe/kiev','europe/kirov','europe/kyiv','europe/lisbon','europe/ljubljana','europe/london','europe/luxembourg','europe/madrid','europe/malta','europe/mariehamn','europe/minsk','europe/monaco','europe/moscow','europe/nicosia','europe/oslo','europe/paris','europe/podgorica','europe/prague','europe/riga','europe/rome','europe/samara','europe/san_marino','europe/sarajevo','europe/saratov','europe/simferopol','europe/skopje','europe/sofia','europe/stockholm','europe/tallinn','europe/tirane','europe/tiraspol','europe/ulyanovsk','europe/uzhgorod','europe/vaduz','europe/vatican','europe/vienna','europe/vilnius','europe/volgograd','europe/warsaw','europe/zagreb','europe/zaporozhye','europe/zurich','gb','gb-eire','gmt','gmt+0','gmt-0','gmt0','greenwich','hst','hongkong','iceland','indian/antananarivo','indian/chagos','indian/christmas','indian/cocos','indian/comoro','indian/kerguelen','indian/mahe','indian/maldives','indian/mauritius','indian/mayotte','indian/reunion','iran','israel','jamaica','japan','kwajalein','libya','met','mst','mst7mdt','mexico/bajanorte','mexico/bajasur','mexico/general','nz','nz-chat','navajo','prc','pst8pdt','pacific/apia','pacific/auckland','pacific/bougainville','pacific/chatham','pacific/chuuk','pacific/easter','pacific/efate','pacific/enderbury','pacific/fakaofo','pacific/fiji','pacific/funafuti','pacific/galapagos','pacific/gambier','pacific/guadalcanal','pacific/guam','pacific/honolulu','pacific/johnston','pacific/kanton','pacific/kiritimati','pacific/kosrae','pacific/kwajalein','pacific/majuro','pacific/marquesas','pacific/midway','pacific/nauru','pacific/niue','pacific/norfolk','pacific/noumea','pacific/pago_pago','pacific/palau','pacific/pitcairn','pacific/pohnpei','pacific/ponape','pacific/port_moresby','pacific/rarotonga','pacific/saipan','pacific/samoa','pacific/tahiti','pacific/tarawa','pacific/tongatapu','pacific/truk','pacific/wake','pacific/wallis','pacific/yap','poland','portugal','roc','rok','singapore','turkey','uct','us/alaska','us/aleutian','us/arizona','us/central','us/east-indiana','us/eastern','us/hawaii','us/indiana-starke','us/michigan','us/mountain','us/pacific','us/samoa','utc','universal','w-su','wet','zulu']::text[]),false) $$;
--> statement-breakpoint
-- These validators describe the immutable management-only packet. They inspect their
-- arguments only: no table lookups, clock, session timezone, provider data or mutable grants.
CREATE FUNCTION finance_budget_policy_object(value jsonb, keys text[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  RETURN value ?& keys AND value - keys = '{}'::jsonb;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION finance_budget_policy_text(value jsonb, maximum integer, canonical boolean DEFAULT true) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text; units integer;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  s := value #>> '{}';
  SELECT coalesce(sum(CASE WHEN ascii(c) > 65535 THEN 2 ELSE 1 END),0) INTO units FROM regexp_split_to_table(s,'') c;
  RETURN units BETWEEN 1 AND maximum AND (NOT canonical OR s = btrim(s,E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)));
END;
$$;
--> statement-breakpoint
CREATE FUNCTION finance_budget_policy_number(value jsonb, minimum numeric, maximum numeric) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  RETURN (value::text)::numeric BETWEEN minimum AND maximum AND trunc((value::text)::numeric) = (value::text)::numeric;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION finance_budget_policy_json_valid(value jsonb, kind text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; collection jsonb; key text; seen text[]; total numeric; positive numeric := 0; ok boolean; d date; text_value text;
BEGIN
  IF value IS NULL THEN RETURN false; END IF;
  CASE kind
  WHEN 'uuid' THEN
    RETURN coalesce(jsonb_typeof(value) = 'string' AND (value #>> '{}') ~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',false);
  WHEN 'ref' THEN
    RETURN finance_budget_policy_object(value,ARRAY['id','revision']) AND finance_budget_policy_json_valid(value->'id','uuid') AND finance_budget_policy_text(value->'revision',200);
  WHEN 'timestamp' THEN
    IF jsonb_typeof(value) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    text_value := value #>> '{}';
    IF text_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' THEN RETURN false; END IF;
    d := substring(text_value,1,10)::date;
    RETURN to_char(d,'YYYY-MM-DD') = substring(text_value,1,10) AND isfinite(text_value::timestamptz);
  WHEN 'period' THEN
    IF NOT finance_budget_policy_object(value,ARRAY['from','through','timezone']) THEN RETURN false; END IF;
    IF jsonb_typeof(value->'from') IS DISTINCT FROM 'string' OR jsonb_typeof(value->'through') IS DISTINCT FROM 'string' OR jsonb_typeof(value->'timezone') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    IF (value->>'from') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-01$' THEN RETURN false; END IF;
    d := (value->>'from')::date;
    RETURN (value->>'through') = to_char(d + interval '1 month - 1 day','YYYY-MM-DD') AND finance_budget_policy_timezone(value->>'timezone');
  WHEN 'directions', 'protections' THEN
    IF jsonb_typeof(value) IS DISTINCT FROM 'array' OR jsonb_array_length(value)>500 THEN RETURN false; END IF;
    seen := ARRAY[]::text[];
    FOR item IN SELECT * FROM jsonb_array_elements(value) LOOP
      IF NOT finance_budget_policy_object(item,CASE WHEN kind='directions' THEN ARRAY['allocationKey','direction'] ELSE ARRAY['allocationKey','minimumCents'] END) OR NOT finance_budget_policy_text(item->'allocationKey',120) THEN RETURN false; END IF;
      key := item->>'allocationKey';
      IF key = ANY(seen) THEN RETURN false; END IF; seen := array_append(seen,key);
      IF kind='directions' THEN
        IF NOT coalesce(jsonb_typeof(item->'direction')='string' AND item->>'direction' IN ('increase','decrease','both'),false) THEN RETURN false; END IF;
      ELSIF NOT finance_budget_policy_number(item->'minimumCents',0,2147483647) THEN RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  WHEN 'terms' THEN
    RETURN finance_budget_policy_object(value,ARRAY['currency','period','rollover','accounting','usageScope','perChangeCapCents','monthlyCapCents','expiresAt','baseline','directions','protections'])
      AND value->'currency'='"USD"'::jsonb AND value->'rollover'='"none"'::jsonb
      AND value->'accounting'='"gross_positive_allocation_deltas"'::jsonb AND value->'usageScope'='"user_month_all_policy_versions"'::jsonb
      AND finance_budget_policy_json_valid(value->'period','period') AND finance_budget_policy_json_valid(value->'expiresAt','timestamp')
      AND finance_budget_policy_json_valid(value->'baseline','ref')
      AND finance_budget_policy_number(value->'perChangeCapCents',0,2147483647) AND finance_budget_policy_number(value->'monthlyCapCents',0,2147483647)
      AND finance_budget_policy_json_valid(value->'directions','directions') AND finance_budget_policy_json_valid(value->'protections','protections');
  WHEN 'plan' THEN
    IF NOT finance_budget_policy_object(value,ARRAY['userId','planId','revision','month','resources','allocations']) OR NOT finance_budget_policy_json_valid(value->'userId','uuid') OR NOT finance_budget_policy_json_valid(value->'planId','uuid') OR NOT finance_budget_policy_json_valid(value->'revision','ref') OR NOT coalesce(jsonb_typeof(value->'month')='string' AND value->>'month' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$',false) THEN RETURN false; END IF;
    FOREACH key IN ARRAY ARRAY['resources','allocations'] LOOP
      collection := value->key; seen := ARRAY[]::text[]; total := 0;
      IF jsonb_typeof(collection) IS DISTINCT FROM 'array' OR jsonb_array_length(collection)>(CASE WHEN key='resources' THEN 100 ELSE 500 END) THEN RETURN false; END IF;
      FOR item IN SELECT * FROM jsonb_array_elements(collection) LOOP
        IF NOT finance_budget_policy_object(item,CASE WHEN key='resources' THEN ARRAY['key','kind','sourceId','amountCents'] ELSE ARRAY['key','kind','targetId','amountCents'] END) OR NOT finance_budget_policy_text(item->'key',120) OR NOT finance_budget_policy_number(item->'amountCents',0,2147483647) THEN RETURN false; END IF;
        IF item->>'key' = ANY(seen) THEN RETURN false; END IF; seen := array_append(seen,item->>'key');
        IF key='resources' THEN
          IF NOT coalesce(item->>'kind' IN ('income','reserve_draw','borrowing','other') AND jsonb_typeof(item->'kind')='string',false) OR NOT (item->'sourceId'='null'::jsonb OR finance_budget_policy_json_valid(item->'sourceId','uuid')) THEN RETURN false; END IF;
        ELSE
          IF NOT coalesce(item->>'kind' IN ('spending','savings','debt','goal','buffer') AND jsonb_typeof(item->'kind')='string',false) OR NOT (item->'targetId'='null'::jsonb OR finance_budget_policy_json_valid(item->'targetId','uuid')) THEN RETURN false; END IF;
        END IF;
        total := total + (item->>'amountCents')::numeric;
      END LOOP;
      IF total>2147483647 THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  WHEN 'tuple' THEN
    IF NOT finance_budget_policy_object(value,ARRAY['userId','planId','policy','policyLifecycleRevision','profile','baseline','activeBudget','latestBudget','positionRevision','usageRevision']) OR NOT finance_budget_policy_json_valid(value->'userId','uuid') OR NOT finance_budget_policy_json_valid(value->'planId','uuid') OR NOT finance_budget_policy_json_valid(value->'policy','ref') OR NOT finance_budget_policy_json_valid(value->'baseline','ref') OR NOT finance_budget_policy_number(value->'policyLifecycleRevision',0,9007199254740991) THEN RETURN false; END IF;
    FOREACH key IN ARRAY ARRAY['profile','activeBudget','latestBudget'] LOOP
      IF NOT (value->key='null'::jsonb OR finance_budget_policy_json_valid(value->key,'ref')) THEN RETURN false; END IF;
    END LOOP;
    FOREACH key IN ARRAY ARRAY['positionRevision','usageRevision'] LOOP
      IF NOT (value->key='null'::jsonb OR finance_budget_policy_text(value->key,200,false)) THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  WHEN 'unavailable' THEN
    RETURN finance_budget_policy_object(value,ARRAY['state','reason']) AND value->'state'='"unavailable"'::jsonb AND jsonb_typeof(value->'reason')='string' AND value->>'reason' IN ('producer_not_registered','missing_evidence','stale_evidence');
  WHEN 'input' THEN
    IF NOT finance_budget_policy_object(value,ARRAY['evaluatedAt','terms','policyState','expected','observed','baseline','current','candidate','position','usage']) THEN RETURN false; END IF;
    RETURN finance_budget_policy_json_valid(value->'evaluatedAt','timestamp') AND finance_budget_policy_json_valid(value->'terms','terms')
      AND jsonb_typeof(value->'policyState')='string' AND value->>'policyState' IN ('draft','disabled','expired','unknown')
      AND finance_budget_policy_json_valid(value->'expected','tuple') AND finance_budget_policy_json_valid(value->'observed','tuple')
      AND (value->'baseline'='null'::jsonb OR finance_budget_policy_json_valid(value->'baseline','plan'))
      AND (value->'current'='null'::jsonb OR finance_budget_policy_json_valid(value->'current','plan'))
      AND finance_budget_policy_json_valid(value->'candidate','plan') AND finance_budget_policy_json_valid(value->'position','unavailable') AND finance_budget_policy_json_valid(value->'usage','unavailable');
  WHEN 'result' THEN
    IF NOT finance_budget_policy_object(value,ARRAY['kind','executionAvailable','executionUnavailableReasons','evaluatedAt','input','revisions','reasons','grossMovedCents','projectedMonthlyUsageCents','deltas']) THEN RETURN false; END IF;
    IF value->'kind' IS DISTINCT FROM '"denied"'::jsonb OR value->'executionAvailable' IS DISTINCT FROM 'false'::jsonb OR value->'executionUnavailableReasons' IS DISTINCT FROM '["authority_not_wired","position_commit_fence_not_wired"]'::jsonb OR NOT finance_budget_policy_json_valid(value->'input','input') OR value->'evaluatedAt' IS DISTINCT FROM value->'input'->'evaluatedAt' OR value->'revisions' IS DISTINCT FROM value->'input'->'observed' OR value->'projectedMonthlyUsageCents' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
    IF jsonb_typeof(value->'reasons') IS DISTINCT FROM 'array' OR jsonb_array_length(value->'reasons')=0 THEN RETURN false; END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(value->'reasons') LOOP
      IF NOT coalesce(jsonb_typeof(item)='string' AND item #>> '{}' IN ('stale_revision','missing_evidence','position_unavailable','position_unqualified','usage_unavailable','scope_mismatch','policy_disabled','policy_expired','policy_unknown','outside_period','resource_changed','allocation_identity_changed','unbalanced_plan','direction_not_permitted','protected_release','protection_floor','per_change_cap','monthly_cap','amount_overflow'),false) THEN RETURN false; END IF;
    END LOOP;
    IF jsonb_typeof(value->'deltas') IS DISTINCT FROM 'array' OR jsonb_array_length(value->'deltas')>500 THEN RETURN false; END IF;
    seen := ARRAY[]::text[];
    FOR item IN SELECT * FROM jsonb_array_elements(value->'deltas') LOOP
      IF NOT finance_budget_policy_object(item,ARRAY['allocationKey','beforeCents','afterCents','deltaCents']) OR NOT finance_budget_policy_text(item->'allocationKey',120) OR NOT finance_budget_policy_number(item->'beforeCents',0,2147483647) OR NOT finance_budget_policy_number(item->'afterCents',0,2147483647) OR NOT finance_budget_policy_number(item->'deltaCents',-2147483647,2147483647) OR (item->>'deltaCents')::numeric <> (item->>'afterCents')::numeric-(item->>'beforeCents')::numeric THEN RETURN false; END IF;
      IF item->>'allocationKey'=ANY(seen) THEN RETURN false; END IF; seen := array_append(seen,item->>'allocationKey');
      positive := positive+greatest(0,(item->>'deltaCents')::numeric);
    END LOOP;
    RETURN (value->'grossMovedCents'='null'::jsonb AND jsonb_array_length(value->'deltas')=0) OR (finance_budget_policy_number(value->'grossMovedCents',0,2147483647) AND (value->>'grossMovedCents')::numeric=positive);
  ELSE RETURN false;
  END CASE;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_plans_id_user_idx" ON "finance_budget_plans" ("id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_versions_id_plan_user_idx" ON "finance_budget_versions" ("id", "plan_id", "user_id");
--> statement-breakpoint
CREATE TABLE "finance_budget_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "lifecycle_revision" integer NOT NULL,
  "state" text NOT NULL,
  "created_by_actor_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "disabled_at" timestamp with time zone,
  "disabled_by_actor_id" text,
  CONSTRAINT "finance_budget_policies_revision_check" CHECK (lifecycle_revision >= 1),
  CONSTRAINT "finance_budget_policies_state_check" CHECK ((state = 'draft' AND disabled_at IS NULL AND disabled_by_actor_id IS NULL) OR (state = 'disabled' AND disabled_at IS NOT NULL AND disabled_by_actor_id IS NOT NULL)),
  CONSTRAINT "finance_budget_policies_owner_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "finance_budget_policies_plan_fk" FOREIGN KEY ("plan_id", "user_id") REFERENCES "finance_budget_plans" ("id", "user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_policies_id_user_idx" ON "finance_budget_policies" ("id", "user_id");
--> statement-breakpoint
CREATE INDEX "finance_budget_policies_user_updated_idx" ON "finance_budget_policies" ("user_id", "updated_at", "id");
--> statement-breakpoint
CREATE INDEX "finance_budget_policies_user_plan_state_idx" ON "finance_budget_policies" ("user_id", "plan_id", "state");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_policies_id_plan_user_idx" ON "finance_budget_policies" ("id", "plan_id", "user_id");
--> statement-breakpoint
CREATE TABLE "finance_budget_policy_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "policy_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "baseline_budget_version_id" uuid NOT NULL,
  "period_month" text NOT NULL,
  "period_from" text NOT NULL,
  "period_through" text NOT NULL,
  "timezone" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "per_change_cap_cents" integer NOT NULL,
  "monthly_cap_cents" integer NOT NULL,
  "currency" text NOT NULL,
  "rollover" text NOT NULL,
  "accounting" text NOT NULL,
  "usage_scope" text NOT NULL,
  "directions" jsonb NOT NULL,
  "protections" jsonb NOT NULL,
  "created_by_actor_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "finance_budget_policy_versions_version_check" CHECK (version >= 1),
  CONSTRAINT "finance_budget_policy_versions_period_check" CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND period_from = period_month || '-01' AND period_through = to_char((period_from::date + interval '1 month - 1 day'), 'YYYY-MM-DD') AND char_length(timezone) BETWEEN 1 AND 100),
  CONSTRAINT "finance_budget_policy_versions_caps_check" CHECK (per_change_cap_cents >= 0 AND monthly_cap_cents >= 0),
  CONSTRAINT "finance_budget_policy_versions_terms_check" CHECK (currency = 'USD' AND rollover = 'none' AND accounting = 'gross_positive_allocation_deltas' AND usage_scope = 'user_month_all_policy_versions'),
  CONSTRAINT "finance_budget_policy_versions_directions_check" CHECK (jsonb_typeof(directions) = 'array' AND octet_length(directions::text) <= 131072),
  CONSTRAINT "finance_budget_policy_versions_protections_check" CHECK (jsonb_typeof(protections) = 'array' AND octet_length(protections::text) <= 131072),
  CONSTRAINT "finance_budget_policy_versions_entries_check" CHECK (jsonb_array_length(directions) <= 500 AND jsonb_array_length(protections) <= 500),
  CONSTRAINT "finance_budget_policy_versions_owner_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "finance_budget_policy_versions_policy_fk" FOREIGN KEY ("policy_id", "plan_id", "user_id") REFERENCES "finance_budget_policies" ("id", "plan_id", "user_id"),
  CONSTRAINT "finance_budget_policy_versions_baseline_fk" FOREIGN KEY ("baseline_budget_version_id", "plan_id", "user_id") REFERENCES "finance_budget_versions" ("id", "plan_id", "user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_policy_versions_id_user_idx" ON "finance_budget_policy_versions" ("id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_policy_versions_policy_owner_idx" ON "finance_budget_policy_versions" ("id", "policy_id", "plan_id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_policy_versions_policy_version_idx" ON "finance_budget_policy_versions" ("policy_id", "version");
--> statement-breakpoint
CREATE INDEX "finance_budget_policy_versions_user_policy_version_idx" ON "finance_budget_policy_versions" ("user_id", "policy_id", "version");
--> statement-breakpoint
CREATE INDEX "finance_budget_policy_versions_user_expiry_idx" ON "finance_budget_policy_versions" ("user_id", "expires_at");
--> statement-breakpoint
CREATE TABLE "finance_budget_revision_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "policy_id" uuid NOT NULL,
  "policy_version_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "profile_version_id" uuid,
  "baseline_budget_version_id" uuid NOT NULL,
  "active_budget_version_id" uuid,
  "latest_budget_version_id" uuid,
  "candidate_snapshot" jsonb NOT NULL,
  "candidate_hash" text NOT NULL,
  "state" text NOT NULL,
  "lifecycle_revision" integer NOT NULL,
  "created_by_actor_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "withdrawn_at" timestamp with time zone,
  "withdrawn_by_actor_id" text,
  CONSTRAINT "finance_budget_revision_proposals_revision_check" CHECK (lifecycle_revision >= 1),
  CONSTRAINT "finance_budget_revision_proposals_state_check" CHECK ((state = 'inactive' AND withdrawn_at IS NULL AND withdrawn_by_actor_id IS NULL) OR (state = 'withdrawn' AND withdrawn_at IS NOT NULL AND withdrawn_by_actor_id IS NOT NULL)),
  CONSTRAINT "finance_budget_revision_proposals_candidate_snapshot_check" CHECK (jsonb_typeof(candidate_snapshot) = 'object' AND octet_length(candidate_snapshot::text) <= 524288),
  CONSTRAINT "finance_budget_revision_proposals_hash_check" CHECK (candidate_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "finance_budget_revision_proposals_owner_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "finance_budget_revision_proposals_policy_version_fk" FOREIGN KEY ("policy_version_id", "policy_id", "plan_id", "user_id") REFERENCES "finance_budget_policy_versions" ("id", "policy_id", "plan_id", "user_id"),
  CONSTRAINT "finance_budget_revision_proposals_plan_fk" FOREIGN KEY ("plan_id", "user_id") REFERENCES "finance_budget_plans" ("id", "user_id"),
  CONSTRAINT "finance_budget_revision_proposals_profile_fk" FOREIGN KEY ("profile_version_id", "user_id") REFERENCES "finance_profile_versions" ("id", "user_id"),
  CONSTRAINT "finance_budget_revision_proposals_baseline_fk" FOREIGN KEY ("baseline_budget_version_id", "plan_id", "user_id") REFERENCES "finance_budget_versions" ("id", "plan_id", "user_id"),
  CONSTRAINT "finance_budget_revision_proposals_active_fk" FOREIGN KEY ("active_budget_version_id", "plan_id", "user_id") REFERENCES "finance_budget_versions" ("id", "plan_id", "user_id"),
  CONSTRAINT "finance_budget_revision_proposals_latest_fk" FOREIGN KEY ("latest_budget_version_id", "plan_id", "user_id") REFERENCES "finance_budget_versions" ("id", "plan_id", "user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_revision_proposals_id_user_idx" ON "finance_budget_revision_proposals" ("id", "user_id");
--> statement-breakpoint
CREATE INDEX "finance_budget_revision_proposals_user_state_created_idx" ON "finance_budget_revision_proposals" ("user_id", "state", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "finance_budget_revision_proposals_user_policy_created_idx" ON "finance_budget_revision_proposals" ("user_id", "policy_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_proposals_version_user_idx" ON "finance_budget_revision_proposals" ("id", "policy_version_id", "user_id");
--> statement-breakpoint
CREATE TABLE "finance_budget_policy_previews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "proposal_id" uuid NOT NULL,
  "policy_version_id" uuid NOT NULL,
  "policy_lifecycle_revision" integer NOT NULL,
  "proposal_lifecycle_revision" integer NOT NULL,
  "input_snapshot" jsonb NOT NULL,
  "result_snapshot" jsonb NOT NULL,
  "preview_hash" text NOT NULL,
  "evaluated_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_by_actor_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "finance_budget_policy_previews_revision_check" CHECK (policy_lifecycle_revision >= 1 AND proposal_lifecycle_revision >= 1),
  CONSTRAINT "finance_budget_policy_previews_expiry_check" CHECK (expires_at > evaluated_at),
  CONSTRAINT "finance_budget_policy_previews_input_snapshot_check" CHECK (jsonb_typeof(input_snapshot) = 'object' AND octet_length(input_snapshot::text) <= 2097152),
  CONSTRAINT "finance_budget_policy_previews_result_snapshot_check" CHECK (jsonb_typeof(result_snapshot) = 'object' AND octet_length(result_snapshot::text) <= 4194304),
  CONSTRAINT "finance_budget_policy_previews_hash_check" CHECK (preview_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "finance_budget_policy_previews_execution_check" CHECK (COALESCE(result_snapshot->'executionAvailable' = 'false'::jsonb AND result_snapshot->>'kind' IN ('hypothetical_preview','denied'), false)),
  CONSTRAINT "finance_budget_policy_previews_owner_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "finance_budget_policy_previews_proposal_fk" FOREIGN KEY ("proposal_id", "policy_version_id", "user_id") REFERENCES "finance_budget_revision_proposals" ("id", "policy_version_id", "user_id"),
  CONSTRAINT "finance_budget_policy_previews_policy_version_fk" FOREIGN KEY ("policy_version_id", "user_id") REFERENCES "finance_budget_policy_versions" ("id", "user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_policy_previews_id_user_idx" ON "finance_budget_policy_previews" ("id", "user_id");
--> statement-breakpoint
CREATE INDEX "finance_budget_policy_previews_user_proposal_created_idx" ON "finance_budget_policy_previews" ("user_id", "proposal_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "finance_budget_policy_previews_user_expiry_idx" ON "finance_budget_policy_previews" ("user_id", "expires_at");
--> statement-breakpoint
CREATE TABLE "finance_budget_period_baselines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "period_month" text NOT NULL,
  "period_from" text NOT NULL,
  "period_through" text NOT NULL,
  "timezone" text NOT NULL,
  "budget_version_id" uuid NOT NULL,
  "confirmed_by_actor_id" text NOT NULL,
  "confirmed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "finance_budget_period_baselines_period_check" CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND period_from = period_month || '-01' AND period_through = to_char((period_from::date + interval '1 month - 1 day'), 'YYYY-MM-DD') AND char_length(timezone) BETWEEN 1 AND 100),
  CONSTRAINT "finance_budget_period_baselines_owner_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "finance_budget_period_baselines_plan_fk" FOREIGN KEY ("plan_id", "user_id") REFERENCES "finance_budget_plans" ("id", "user_id"),
  CONSTRAINT "finance_budget_period_baselines_budget_fk" FOREIGN KEY ("budget_version_id", "plan_id", "user_id") REFERENCES "finance_budget_versions" ("id", "plan_id", "user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_period_baselines_id_user_idx" ON "finance_budget_period_baselines" ("id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budget_period_baselines_user_month_idx" ON "finance_budget_period_baselines" ("user_id", "period_month");
--> statement-breakpoint
CREATE FUNCTION finance_budget_policy_reject_snapshot_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Budget policy history is immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER finance_budget_policy_versions_immutable BEFORE UPDATE ON finance_budget_policy_versions FOR EACH ROW EXECUTE FUNCTION finance_budget_policy_reject_snapshot_update();
--> statement-breakpoint
CREATE TRIGGER finance_budget_policy_previews_immutable BEFORE UPDATE ON finance_budget_policy_previews FOR EACH ROW EXECUTE FUNCTION finance_budget_policy_reject_snapshot_update();
--> statement-breakpoint
CREATE TRIGGER finance_budget_period_baselines_immutable BEFORE UPDATE ON finance_budget_period_baselines FOR EACH ROW EXECUTE FUNCTION finance_budget_policy_reject_snapshot_update();
--> statement-breakpoint
CREATE FUNCTION finance_budget_policy_guard_root_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE allowed text[];
BEGIN
  IF TG_TABLE_NAME = 'finance_budget_policies' THEN
    allowed := ARRAY['state','lifecycle_revision','updated_at','disabled_at','disabled_by_actor_id'];
  ELSE
    allowed := ARRAY['state','lifecycle_revision','updated_at','withdrawn_at','withdrawn_by_actor_id'];
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed)
    OR NEW.lifecycle_revision < OLD.lifecycle_revision
    OR (OLD.state IN ('disabled','withdrawn') AND NEW.state IS DISTINCT FROM OLD.state) THEN
    RAISE EXCEPTION 'Budget policy root identity and snapshots are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER finance_budget_policies_guard_update BEFORE UPDATE ON finance_budget_policies FOR EACH ROW EXECUTE FUNCTION finance_budget_policy_guard_root_update();
--> statement-breakpoint
CREATE TRIGGER finance_budget_revision_proposals_guard_update BEFORE UPDATE ON finance_budget_revision_proposals FOR EACH ROW EXECUTE FUNCTION finance_budget_policy_guard_root_update();

--> statement-breakpoint
ALTER TABLE "finance_budget_policy_versions" ADD CONSTRAINT "finance_budget_policy_versions_contract_check" CHECK (finance_budget_policy_json_valid(directions,'directions') IS TRUE AND finance_budget_policy_json_valid(protections,'protections') IS TRUE AND finance_budget_policy_json_valid(jsonb_build_object('from',period_from,'through',period_through,'timezone',timezone),'period') IS TRUE);

--> statement-breakpoint
ALTER TABLE "finance_budget_policy_versions" ADD CONSTRAINT "finance_budget_policy_versions_scalar_contract_check" CHECK (finance_budget_policy_json_valid(to_jsonb(id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(user_id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(policy_id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(plan_id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(baseline_budget_version_id),'uuid') IS TRUE AND isfinite(created_at) AND created_at>='0001-01-01T00:00:00Z'::timestamptz AND created_at<'10000-01-01T00:00:00Z'::timestamptz AND isfinite(expires_at) AND expires_at>='0001-01-01T00:00:00Z'::timestamptz AND expires_at<'10000-01-01T00:00:00Z'::timestamptz);

--> statement-breakpoint
ALTER TABLE "finance_budget_revision_proposals" ADD CONSTRAINT "finance_budget_revision_proposals_contract_check" CHECK (finance_budget_policy_json_valid(candidate_snapshot,'plan') IS TRUE AND candidate_snapshot->>'userId'=user_id::text AND candidate_snapshot->>'planId'=plan_id::text);

--> statement-breakpoint
ALTER TABLE "finance_budget_revision_proposals" ADD CONSTRAINT "finance_budget_revision_proposals_scalar_contract_check" CHECK (finance_budget_policy_json_valid(to_jsonb(id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(user_id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(policy_id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(policy_version_id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(plan_id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(baseline_budget_version_id),'uuid') IS TRUE AND (profile_version_id IS NULL OR (finance_budget_policy_json_valid(to_jsonb(profile_version_id),'uuid') IS TRUE)) AND (active_budget_version_id IS NULL OR (finance_budget_policy_json_valid(to_jsonb(active_budget_version_id),'uuid') IS TRUE)) AND (latest_budget_version_id IS NULL OR (finance_budget_policy_json_valid(to_jsonb(latest_budget_version_id),'uuid') IS TRUE)) AND isfinite(created_at) AND created_at>='0001-01-01T00:00:00Z'::timestamptz AND created_at<'10000-01-01T00:00:00Z'::timestamptz AND isfinite(updated_at) AND updated_at>='0001-01-01T00:00:00Z'::timestamptz AND updated_at<'10000-01-01T00:00:00Z'::timestamptz AND (withdrawn_at IS NULL OR (isfinite(withdrawn_at) AND withdrawn_at>='0001-01-01T00:00:00Z'::timestamptz AND withdrawn_at<'10000-01-01T00:00:00Z'::timestamptz)));

--> statement-breakpoint
ALTER TABLE "finance_budget_policy_previews" ADD CONSTRAINT "finance_budget_policy_previews_contract_check" CHECK (finance_budget_policy_json_valid(input_snapshot,'input') IS TRUE AND finance_budget_policy_json_valid(result_snapshot,'result') IS TRUE AND result_snapshot->'input'=input_snapshot AND (input_snapshot->>'evaluatedAt')::timestamptz=evaluated_at AND expires_at <= (input_snapshot->'terms'->>'expiresAt')::timestamptz AND input_snapshot->'observed'->>'userId'=user_id::text AND input_snapshot->'observed'->'policy'->>'id'=policy_version_id::text);

--> statement-breakpoint
ALTER TABLE "finance_budget_policy_previews" ADD CONSTRAINT "finance_budget_policy_previews_scalar_contract_check" CHECK (finance_budget_policy_json_valid(to_jsonb(id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(user_id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(proposal_id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(policy_version_id),'uuid') IS TRUE AND isfinite(created_at) AND created_at>='0001-01-01T00:00:00Z'::timestamptz AND created_at<'10000-01-01T00:00:00Z'::timestamptz AND isfinite(evaluated_at) AND evaluated_at>='0001-01-01T00:00:00Z'::timestamptz AND evaluated_at<'10000-01-01T00:00:00Z'::timestamptz AND isfinite(expires_at) AND expires_at>='0001-01-01T00:00:00Z'::timestamptz AND expires_at<'10000-01-01T00:00:00Z'::timestamptz);

--> statement-breakpoint
ALTER TABLE "finance_budget_period_baselines" ADD CONSTRAINT "finance_budget_period_baselines_contract_check" CHECK (finance_budget_policy_json_valid(jsonb_build_object('from',period_from,'through',period_through,'timezone',timezone),'period') IS TRUE);

--> statement-breakpoint
ALTER TABLE "finance_budget_period_baselines" ADD CONSTRAINT "finance_budget_period_baselines_scalar_contract_check" CHECK (finance_budget_policy_json_valid(to_jsonb(id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(user_id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(plan_id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(budget_version_id),'uuid') IS TRUE AND isfinite(confirmed_at) AND confirmed_at>='0001-01-01T00:00:00Z'::timestamptz AND confirmed_at<'10000-01-01T00:00:00Z'::timestamptz);

--> statement-breakpoint
ALTER TABLE "finance_budget_policies" ADD CONSTRAINT "finance_budget_policies_scalar_contract_check" CHECK (finance_budget_policy_json_valid(to_jsonb(id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(user_id),'uuid') IS TRUE AND finance_budget_policy_json_valid(to_jsonb(plan_id),'uuid') IS TRUE AND isfinite(created_at) AND created_at>='0001-01-01T00:00:00Z'::timestamptz AND created_at<'10000-01-01T00:00:00Z'::timestamptz AND isfinite(updated_at) AND updated_at>='0001-01-01T00:00:00Z'::timestamptz AND updated_at<'10000-01-01T00:00:00Z'::timestamptz AND (disabled_at IS NULL OR (isfinite(disabled_at) AND disabled_at>='0001-01-01T00:00:00Z'::timestamptz AND disabled_at<'10000-01-01T00:00:00Z'::timestamptz)));
