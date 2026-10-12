# 한국 도로 데이터

코스 검색 API는 공용 Overpass 대신 서버에 저장된 한국 OSM 도로 SQLite를 조회합니다. 지도 배경과 고도 서비스는 별도입니다. 한국 밖은 지원하지 않습니다. 원본 노드 ID, 전체 길 좌표, 통행 제한 태그를 유지합니다.

현재 환경에서 설치·갱신:

```powershell
eval/recognition/model-env/Scripts/python.exe scripts/prepare-roads.py --date 261009
```

`--date`는 Geofabrik에 존재하는 추출 날짜 YYMMDD입니다. Python 3.11 이상과 `osmium==4.3.1`이 필요합니다 (`python -m pip install osmium==4.3.1`). 공식 파일의 MD5를 검증한 뒤 공간 색인을 만들고, 완료된 버전으로 manifest를 교체합니다. 실패하면 기존 manifest를 유지합니다. 갱신은 수동입니다. 검색 결과의 데이터 기준 날짜는 원본 PBF 헤더에서 읽습니다.

기본 위치는 `data/roads/`이며 Git에서 제외합니다. `ROAD_DATA_DIR`로 서버의 영구 저장 경로를 지정할 수 있습니다. Node 22.13 이상이 필요하며 현재 Node 24에서 검증합니다. 배포 시 SQLite 파일과 manifest.json을 영구 볼륨에 별도로 설치해야 합니다. 파일이 없는 서버는 설치 오류를 반환하며 공용 API로 우회하지 않습니다. 원본 PBF는 갱신 검증용이며 앱 조회에는 필요하지 않습니다.

지도 데이터는 현장 공사·임시 통제·실제 통행 가능 여부를 보장하지 않습니다. 출처: [Geofabrik South Korea](https://download.geofabrik.de/asia/south-korea.html), [OpenStreetMap 저작권 및 ODbL](https://www.openstreetmap.org/copyright). 재배포할 때 ODbL 조건과 출처 표시를 유지해야 합니다.
