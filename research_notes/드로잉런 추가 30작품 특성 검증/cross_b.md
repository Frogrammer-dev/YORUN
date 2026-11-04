# B 연구자의 A 배치 3작품 교차 관찰

2026-10-21. A 연구자가 제공한 원본 지도 이미지URL을 별도 브라우저 탭에서 직접 열어 픽셀을 확인했다. 제목/선행 코딩을 알고 본 같은 AI 계열의 검토이며 사람 블라인드 인식 실험이나 통계적 독립 코더 일치도가 아니다. 실제 실행·거리 원문 확인은 A 배치가 담당하고 이 문서는 픽셀 특성 재검토다.

## A04 미국 지도,6.8km

[직접 관찰 이미지](https://d3o5xota0a1fcr.cloudfront.net/v6/maps/YAVF7OJI77BAOL25ME2HRQP2FFORJTAKPHD3KSKL66ZGAAWLGQGL2COOQJMKQ7XFC3AHR2DFSVLJA6PIDMZNG===), 활동1070128185.

- 전체는 미국 지도 외곽을 둘러싼 하나의 고리처럼 보인다.
- 다만 오대호로 해석되는 오른쪽 위쪽 접힘에서 좁은 고리와 선 접점이 보여, 픽셀만으로 단순 경계의 안쪽 굴곡인지 자기접촉/내부 연결인지 확정하기 어렵다.
- B 독립 코딩 권고: internal_strokes=uncertain, branch_or_open_strokes=uncertain, parts_relation=no, angular_road_noise=uncertain, simple_single_outline=uncertain.
- 최초 A의 simple=yes와 불일치. 이 작품을 확실한 단일폐윤곽 반례로 단정하기보다 모호 사례로 유지하는 것이 보수적이다. 이 불일치를 A와 root에 전달했다. 한국 B09는 선명한 단일윤곽 반례로 따로 존재한다.
- A의 후속 재관찰: 오대호의 작은 고리 접점을 확인해 internal/branch/simple을 모두uncertain으로 정정했다고 회신했다. 이 문서는 최초 불일치와 후속 합의 경위를 보존한다.

## A10 엄지척,5.3km

[직접 관찰 이미지](https://d3o5xota0a1fcr.cloudfront.net/v6/maps/NHYE2CG3MLMZAFR6OE5WHMEFPAHLJLSLMESWMRJWZTJDOXNEKJTUD2VDTMRCEHZHUHKK2JNUHEOKHLLC7ECC2===), 활동12426173264.

- 손목 왼쪽 소매 부분과 손 전체를 가르는 주황색 세로선이 실제 작품 획이다. 배경의 회색 도로와 구별된다.
- 위로 솟은 엄지, 오른쪽 손 덩어리, 왼쪽 소매의 상대 배치가 보인다.
- B 코딩: internal_strokes=yes, branch_or_open_strokes=yes, parts_relation=yes, angular_road_noise=no, simple_single_outline=no.
- 주요 내부 획/부분 관계 판단은 A와 일치. 작은 꺾임은 현재 그림에서 반복 격자 잡음으로 확정할 만큼 보이지 않는다.

## A08 세계지도,33.5km

[직접 관찰 이미지](https://d3o5xota0a1fcr.cloudfront.net/v6/maps/5PDB7NLD4LBYN5GW572MTUPZ3MLAMHIKBPDETOXQRDSC2VMAU7JOOFQ5FX5AAQSO63YQ3F2I3TZUM4MLEX7YW===), 활동12067605647.

- 검은 실제 GPS 선으로 여러 대륙을 배치한다. 아메리카와 아프리카·유라시아·호주의 상대 위치가 보인다.
- 아프리카 윤곽 안을 좌우로 가르는 검은 가느다란 선이 보여 B는 internal_strokes=yes로 읽었다. 최초 A는 여러 대륙 윤곽과 연결선 혼동 때문에 uncertain으로 코딩했다. 의미 세부선과 이동 연결선을 구별해 해석해야 한다.
- A의 후속 재관찰: 아프리카·남아메리카 내부 가로지르는 검은 연결 획을 확인해 internal=yes로 정정했다고 회신했다. 그림 내부 획의 존재와 그 선의 의미적 필요성은 별개다.
- B 코딩: internal_strokes=yes, branch_or_open_strokes=yes, parts_relation=yes, angular_road_noise=yes, simple_single_outline=no.
- 도로 배경은 흰색/회색이며 검은 작품선만 코딩했다. 대륙 사이 연결선에서 실제 pause·왕복을 추론하지 않았다.

세 작품의 주요 결론은 복합 표현이 존재한다는 점을 지지하지만, 모호한 작은 고리의 단순/내부 분류는 한 장의 축소 지도로 확정하기 어렵다는 한계도 드러낸다.
