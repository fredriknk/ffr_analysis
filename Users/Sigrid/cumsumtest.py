import pandas as pd
import matplotlib.pyplot as plt
plt.ioff()
import numpy as np
from time import time
from multiprocessing import Pool
from scipy import interpolate
from math import sqrt,floor,ceil
from scipy import integrate


if __name__ == "__main__":

    treatment_legend =  {1: {'name': 'Control N1', 'plots': [9, 19, 30]},
                         2: {'name': 'Control N2', 'plots': [2, 18, 27]},
                         3: {'name': 'Perenial ryegrass N1', 'plots': [12, 23, 25]},
                         4: {'name': 'Perenial ryegrass N2', 'plots': [5, 15, 28]},
                         5: {'name': 'Italian ryegrass N1', 'plots': [10, 17, 29]},
                         6: {'name': 'Italian ryegrass N2', 'plots': [1, 22, 32]},
                         7: {'name': 'Summer vetch N1', 'plots': [4, 20, 36]},
                         8: {'name': 'Winter vetch N1', 'plots': [11, 21, 35]},
                         9: {'name': 'Oilseed radish N1', 'plots': [6, 24, 34]},
                         10: {'name': 'Oilseed radish N2', 'plots': [8, 16, 26]},
                         11: {'name': 'Phaselia N2', 'plots': [7, 14, 31]},
                         12: {'name': 'Grønn bro N1', 'plots': [3, 13, 33]}}

    start = time()
    filename = "output/capture_slopes.xls"  #filename for raw output
    df = pd.read_excel(filename) # import excel docuument

    df['date'] = pd.to_datetime(df['date']) # make date column to datetime objects
    df = df.sort_values(by=['date']) #sort all entries by date
    # df = df.set_index('date')
    treatments = {}
    for treatment in np.sort(df['treatment'].unique()):
        fig, (ax1, ax2, ax3) = plt.subplots(nrows=3, ncols=1, sharex=True)

        tot_n2o_sum = np.array([])

        for plotno in np.sort(df[df['treatment'] == treatment]['nr'].unique()):

            plot = df[df['nr'] == plotno] # select the data from plot 2

            n2o = plot['N2O_N_mug_m2h']*10000/1e9
            n2o_avg = n2o.rolling(window=2).mean()
            n2o_avg.iloc[0] = 0.

            timediff = plot["date"].diff()/ pd.Timedelta(hours=1)
            timediff.iloc[0] = 0.

            n2o_sum = n2o_avg*timediff

            n2o_int = n2o_sum.cumsum()

            tot_n2o_sum = np.append(tot_n2o_sum , n2o_sum.sum())

            ax1.plot(plot["date"],n2o_int)
            ax1.set_ylabel('Cumulative\nNO2 kg/ha/hour')

            ax2.plot(plot["date"],n2o_sum,'.')
            ax3.plot(plot["date"], n2o,'.')
            ax3.set_xlabel("date")

        ax1.set_title('N2O Release %s %i, %.2f ' % (treatment_legend[treatment]["name"],
                                                    treatment,
                                                    np.average(tot_n2o_sum)))
        plt.gcf().autofmt_xdate()
        plt.show()